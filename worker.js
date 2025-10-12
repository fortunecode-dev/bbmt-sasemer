// src/index.js
export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'GET') return new Response('Worker OK', { status: 200 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      let body;
      try { body = await request.json(); } 
      catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!body) return new Response('No body', { status: 400 });

      const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN || "8321034986:AAFsu8feD7r3Se8o9-lPSQdhSnhQY6tAI5E";
      const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

      const sendMessage = (chat_id, text, options = {}) =>
        fetch(`${API}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, text, parse_mode: 'Markdown', ...options }) });

      const editMessage = (chat_id, message_id, text, options = {}) =>
        fetch(`${API}/editMessageText`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, message_id, text, parse_mode: 'Markdown', ...options }) });

      const answerCallback = (callback_query_id, text = '') =>
        fetch(`${API}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id, text }) });

      // --- Procesar mensajes de texto ---
      if (body.message?.text?.startsWith('Remesa')) {
        const msg = body.message;
        const chat_id = msg.chat.id;
        const user_id = msg.from.id;
        const username = msg.from.username || msg.from.first_name || 'Usuario';
        const mention = `[@${username}](tg://user?id=${user_id})`;

        const parts = msg.text.split(' ');
        if (parts.length >= 3) {
          const sent = parseFloat(parts[1]);
          const given = parseFloat(parts[2]);
          const clientName = parts.slice(3).join(' ');
          const gain = Math.abs(given - sent);
          const commission = +(gain * 0.2).toFixed(2);

          const text = `**Cliente:** ${clientName}
**Remesa:** ${sent} ➡️ ${given}
**Ganancia:** $${gain}
**Comisión:** $${commission} (${mention})
**Fecha:** ${new Date().toLocaleDateString('en-GB')}`;

          const reply_markup = {
            inline_keyboard: [
              [
                { text: '✅ Confirmar', callback_data: 'confirm' },
                { text: '⚠️ Deshacer Confirmar', callback_data: 'undo_confirm' },
              ],
              [
                { text: '📦 Entregado', callback_data: 'delivered' },
                { text: '⚠️ Deshacer Entregado', callback_data: 'undo_delivered' },
              ],
            ],
          };

          await sendMessage(chat_id, text, { reply_markup });

          try {
            await fetch(`${API}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, message_id: msg.message_id }) });
          } catch (err) { console.log('No se pudo borrar mensaje original', err); }
        }
      }

      // --- Procesar callbacks ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;
        let lines = cb.message.text.split('\n');

        switch(cb.data) {
          case 'confirm':
            lines = lines.filter(line => !line.includes('✅ Confirmado')); // eliminar si ya hay
            lines.push(`**✅ Confirmado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
            break;
          case 'delivered':
            lines = lines.filter(line => !line.includes('📦 Entregado'));
            lines.push(`**📦 Entregado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
            break;
          case 'undo_confirm':
            lines = lines.filter(line => !line.includes('✅ Confirmado'));
            break;
          case 'undo_delivered':
            lines = lines.filter(line => !line.includes('📦 Entregado'));
            break;
        }

        const new_text = lines.join('\n');

        const reply_markup = {
          inline_keyboard: [
            [
              line.includes('✅ Confirmado')?{ text: '⚠️ Deshacer Confirmar', callback_data: 'undo_confirm' }:{ text: '✅ Confirmar', callback_data: 'confirm' }
            ],
            [
              line.includes('📦 Entregado')?{ text: '⚠️ Deshacer Entregado', callback_data: 'undo_delivered' }:{ text: '📦 Entregado', callback_data: 'delivered' },
            ],
          ],
        };

        await editMessage(chat_id, message_id, new_text, { reply_markup });
        await answerCallback(cb.id);
      }

      return new Response(JSON.stringify({ ok: true, body }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      console.error(err);
      return new Response('Internal Error', { status: 500 });
    }
  },
};
