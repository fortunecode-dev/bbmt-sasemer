// src/index.js
export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'GET') return new Response('Worker OK', { status: 200 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      let body;
      try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!body) return new Response('No body', { status: 400 });

      const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN;
      if (!TELEGRAM_TOKEN) return new Response('Missing TELEGRAM_TOKEN', { status: 500 });
      const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

      // helpers básicos
      const tgFetch = (path, method = 'GET', payload) =>
        fetch(`${API}/${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: payload ? JSON.stringify(payload) : undefined,
        });

      const tgSendMessage = async (chat_id, text, opts = {}) => {
        const payload = { chat_id, text, ...opts };
        const res = await tgFetch('sendMessage', 'POST', payload);
        return res.json(); // devuelve el objeto JSON de Telegram
      };

      const tgEditMessage = (chat_id, message_id, text, opts = {}) =>
        tgFetch('editMessageText', 'POST', { chat_id, message_id, text, ...opts });

      const tgAnswerCallback = (callback_query_id, text = '') =>
        tgFetch('answerCallbackQuery', 'POST', { callback_query_id, text });

      const tgGetChat = (chat_id) =>
        tgFetch(`getChat?chat_id=${encodeURIComponent(chat_id)}`, 'GET');

      const tgPinChatMessage = (chat_id, message_id, opts = {}) =>
        tgFetch('pinChatMessage', 'POST', { chat_id, message_id, ...opts });

      // --- Procesar mensajes de texto (crear remesa) ---
      if (body.message && typeof (body.message.text || body.message.caption) === 'string') {
        const rawText = (body.message.text || body.message.caption || '').trim();
        if (/^\s*Remesa\s+/i.test(rawText)) {
          const msg = body.message;
          const chat_id = msg.chat.id;
          const user_id = msg.from?.id;
          const username = msg.from?.username || msg.from?.first_name || 'Usuario';
          const parts = rawText.split(/\s+/);
          if (parts.length >= 3) {
            const sent = parseFloat(parts[1].replace(',', '.')) || 0;
            const given = parseFloat(parts[2].replace(',', '.')) || 0;
            const clientName = parts.slice(3).join(' ') || 'Cliente';
            const gain = Math.abs(given - sent);
            const commission = +(gain * 0.2).toFixed(2);

            const text = `**Confirma ${sent}**
**Cliente:** ${clientName}
**Remesa:** ${sent} ➡️ ${given}
**Ganancia:** $${gain}
**Comisión:** $${commission} (@${username})
**Fecha:** ${new Date().toLocaleDateString('en-GB')}`;

            const reply_markup = {
              inline_keyboard: [
                [{ text: '✅ Confirmar', callback_data: 'confirm' }],
                [{ text: '📦 Entregado', callback_data: 'delivered' }],
              ],
            };

            // enviar en modo silencioso para que el grupo no se alarme
            await tgSendMessage(chat_id, text, { reply_markup, parse_mode: 'Markdown', disable_notification: true });

            // intentar borrar original si corresponde (silencioso)
            try {
              await tgFetch('deleteMessage', 'POST', { chat_id, message_id: msg.message_id, disable_notification: true });
            } catch (e) {
              console.log('No se pudo borrar mensaje original', e);
            }
          }
        }

        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // --- Procesar callbacks ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;
        let lines = (cb.message.text || '').split('\n').map(l => l.trim()).filter(Boolean);

        const hasConfirmed = lines.some(l => /✅ Confirmado/.test(l));
        const hasDelivered = lines.some(l => /📦 Entregado/.test(l));

        // Acción principal
        if (cb.data === 'confirm') {
          if (!hasConfirmed) {
            // quitar encabezado "Confirma X" si existe
            lines = lines.filter(line => !/^Confirma\s+\d+/i.test(line));
            // agregar línea confirmado
            lines.push(`**✅ Confirmado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
          }

          // ---- aquí: comprobar pinned_message ----
          try {
            const resp = await tgGetChat(chat_id);
            const j = await resp.json();
            const pinnedExists = !!(j && j.result && j.result.pinned_message);

            if (!pinnedExists) {
              // crear primer resumen en modo silencioso y pinnearlo
              const now = new Date();
              const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' });
              const summaryText = `📌 *Resumen acumulado (${monthYear})*\n\n_No hay entradas aún. Este resumen se irá actualizando._`;

              // enviar en modo silencioso
              const sent = await tgSendMessage(chat_id, summaryText, { parse_mode: 'Markdown', disable_notification: true });
              // sent.result.message_id contiene el id del mensaje enviado
              const pinnedMsgId = sent && sent.result && sent.result.message_id;
              if (pinnedMsgId) {
                // pin the message (silencioso)
                await tgPinChatMessage(chat_id, pinnedMsgId, { disable_notification: true });
              } else {
                console.log('No se obtuvo message_id del summary para pin.');
              }
            }

            // enviar true/false como mensaje silencioso (opcional; el requisito original pedía esto)
            await tgSendMessage(chat_id, pinnedExists ? 'true' : 'false', { disable_notification: true });

          } catch (err) {
            console.error('Error consultando getChat o creando/pineando summary:', err);
            // fallback: escribir false silencioso
            try { await tgSendMessage(chat_id, 'false', { disable_notification: true }); } catch (e) { console.error(e); }
          }
        }

        // manejar delivered y undo (mantengo tu lógica básica)
        if (cb.data === 'delivered') {
          if (!hasDelivered) {
            lines.push(`**📦 Entregado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
          }
        } else if (cb.data === 'undo_confirm') {
          lines = lines.filter(line => !/✅ Confirmado/.test(line));
        } else if (cb.data === 'undo_delivered') {
          lines = lines.filter(line => !/📦 Entregado/.test(line));
        }

        // recompute states and keyboard
        const nowHasConfirmed = lines.some(l => /✅ Confirmado/.test(l));
        const nowHasDelivered = lines.some(l => /📦 Entregado/.test(l));

        const inline_keyboard = [
          nowHasConfirmed ? [{ text: '⚠️ ❌ Deshacer Confirmar', callback_data: 'undo_confirm' }] : [{ text: '✅ Confirmar', callback_data: 'confirm' }],
          nowHasDelivered ? [{ text: '⚠️ ❌ Deshacer Entregado', callback_data: 'undo_delivered' }] : [{ text: '📦 Entregado', callback_data: 'delivered' }],
        ];

        const new_text = lines.join('\n');
        await tgEditMessage(chat_id, message_id, new_text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard }, disable_notification: true });
        await tgAnswerCallback(cb.id);

        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // nothing else
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      console.error('Worker error:', err);
      return new Response('Internal Error', { status: 500 });
    }
  },
};
