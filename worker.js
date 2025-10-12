// src/index.js
export default {
  async fetch(request, env) {
    try {
      if (request.method === 'GET') return new Response('Worker OK', { status: 200 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      let body;
      try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!body) return new Response('No body', { status: 400 });

      const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN;
      if (!TELEGRAM_TOKEN) return new Response('Missing TELEGRAM_TOKEN', { status: 500 });
      const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

      const tgSendMessage = (chat_id, text, opts = {}) =>
        fetch(`${API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, ...opts }),
        });

      const tgEditMessage = (chat_id, message_id, text, opts = {}) =>
        fetch(`${API}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, message_id, text, ...opts }),
        });

      const tgAnswerCallback = (callback_query_id, text = '') =>
        fetch(`${API}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id, text }),
        });

      const tgGetChat = (chat_id) =>
        fetch(`${API}/getChat?chat_id=${encodeURIComponent(chat_id)}`, { method: 'GET' });

      // --- Process message creation (light) ---
      if (body.message && body.message.text && body.message.text.startsWith('Remesa')) {
        // Aquí solo reenviamos en formato simple (puedes integrar tu formato actual)
        const msg = body.message;
        const chat_id = msg.chat.id;
        const parts = msg.text.split(' ');
        if (parts.length >= 3) {
          const sent = parseFloat(parts[1]) || 0;
          const given = parseFloat(parts[2]) || 0;
          const client = parts.slice(3).join(' ') || 'Cliente';
          const gain = Math.abs(given - sent);
          const commission = +(gain * 0.2).toFixed(2);

          const text = `**Cliente:** ${client}\n**Remesa:** ${sent} ➡️ ${given}\n**Ganancia:** $${gain}\n**Comisión:** $${commission}\n**Fecha:** ${new Date().toLocaleDateString('en-GB')}`;
          const reply_markup = {
            inline_keyboard: [
              [{ text: '✅ Confirmar', callback_data: 'confirm' }],
              [{ text: '📦 Entregado', callback_data: 'delivered' }]
            ]
          };

          await tgSendMessage(chat_id, text, { reply_markup, parse_mode: 'Markdown' });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // --- Process callbacks ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;
        let text = cb.message.text || '';

        if (cb.data === 'confirm') {
          // Añadir línea de confirmado (si no existe)
          if (!/Confirmado/.test(text)) {
            text += `\n**✅ Confirmado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
          }

          // editar mensaje para mostrar confirmado
          await tgEditMessage(chat_id, message_id, text, { parse_mode: 'Markdown', disable_notification: true });

          // Ahora: comprobar si hay message anclado en el chat mediante getChat
          try {
            const resp = await tgGetChat(chat_id);
            const j = await resp.json();
            // j.result puede contener pinned_message si existe
            const pinnedExists = !!(j && j.result && j.result.pinned_message);
            // Escribir "true" o "false" en el chat (puedes cambiar formato)
            await tgSendMessage(chat_id, pinnedExists ? 'true' : 'false', { disable_notification: true });
          } catch (err) {
            console.error('Error consultando getChat:', err);
            // opcional: notificar fallo en chat
            await tgSendMessage(chat_id, 'false', { disable_notification: true });
          }

          await tgAnswerCallback(cb.id);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        // Mantén tu manejo de otros callbacks (delivered, undo, etc.) aquí...
        if (cb.data === 'delivered') {
          if (!/Entregado/.test(text)) {
            text += `\n**📦 Entregado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
            await tgEditMessage(chat_id, message_id, text, { parse_mode: 'Markdown', disable_notification: true });
          }
          await tgAnswerCallback(cb.id);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        // undo handlers example
        if (cb.data === 'undo_confirm') {
          text = text.replace(/\n\*\u2705 Confirmado\*:[^\n]*/i, ''); // intentar eliminar la línea Confirmado
          // fallback: eliminar cualquier línea que contenga "Confirmado"
          text = text.split('\n').filter(l => !/Confirmado/.test(l)).join('\n');
          await tgEditMessage(chat_id, message_id, text, { parse_mode: 'Markdown', disable_notification: true });
          await tgAnswerCallback(cb.id);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (cb.data === 'undo_delivered') {
          text = text.split('\n').filter(l => !/Entregado/.test(l)).join('\n');
          await tgEditMessage(chat_id, message_id, text, { parse_mode: 'Markdown', disable_notification: true });
          await tgAnswerCallback(cb.id);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      console.error(err);
      return new Response('Internal Error', { status: 500 });
    }
  }
};
