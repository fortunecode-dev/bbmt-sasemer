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

      const TELEGRAM_TOKEN = "8321034986:AAFsu8feD7r3Se8o9-lPSQdhSnhQY6tAI5E";
      const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

      const escapeMarkdownV2 = (text) => text
        .replace(/_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/~/g, '\\~')
        .replace(/`/g, '\\`')
        .replace(/>/g, '\\>')
        .replace(/#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/-/g, '\\-')
        .replace(/=/g, '\\=')
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\./g, '\\.')
        .replace(/!/g, '\\!');

      const sendMessage = (chat_id, text, options = {}) =>
        fetch(`${API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, parse_mode: 'MarkdownV2', ...options }),
        });

      const editMessage = (chat_id, message_id, text, options = {}) =>
        fetch(`${API}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, message_id, text, parse_mode: 'MarkdownV2', ...options }),
        });

      const answerCallback = (callback_query_id, text = '') =>
        fetch(`${API}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id, text }),
        });

      // --- Process Message ---
      if (body.message) {
        const msg = body.message;
        const chat_id = msg.chat.id;

        if (msg.text && msg.text.startsWith('Remesa')) {
          const parts = msg.text.split(' ');
          if (parts.length >= 3) {
            const sent = parseFloat(parts[1]);
            const received = parseFloat(parts[2]);
            const clientName = parts.slice(3).join(' ');
            const gain = received - sent;
            const commissionValue = +(gain * 0.2).toFixed(2);
            const user = msg.from.username || msg.from.first_name;

            const mention = msg.from.username ? `[@${escapeMarkdownV2(user)}](tg://user?id=${msg.from.id})` : escapeMarkdownV2(user);

            let text = `**Cliente:** ${escapeMarkdownV2(clientName)}\n` +
                       `**Remesa:** ${sent} ➡️ ${received}\n` +
                       `**Ganancia:** $${gain}\n` +
                       `**Comisión:** $${commissionValue} (${mention})\n` +
                       `**Fecha:** ${new Date().toLocaleDateString('en-GB')}`;

            const reply_markup = {
              inline_keyboard: [
                [
                  { text: '✅ Confirmar', callback_data: 'confirm' },
                  { text: '❌ Deshacer Confirmar', callback_data: 'undo_confirm' },
                ],
                [
                  { text: '📦 Entregado', callback_data: 'delivered' },
                  { text: '🛑 Deshacer Entregado', callback_data: 'undo_delivered' },
                ],
              ],
            };

            await sendMessage(chat_id, text, { reply_markup });
          }
        }
      }

      // --- Process Callback ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;

        let text = cb.message.text;

        switch (cb.data) {
          case 'confirm':
            text = text.replace(/(\*\*Confirmado:\*\*.+\n?)?/g, '');
            text += `\n**Confirmado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
            break;
          case 'undo_confirm':
            text = text.replace(/\n\*\*Confirmado:\*\*.+/g, '');
            break;
          case 'delivered':
            text = text.replace(/(\*\*Entregado:\*\*.+\n?)?/g, '');
            text += `\n**Entregado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
            break;
          case 'undo_delivered':
            text = text.replace(/\n\*\*Entregado:\*\*.+/g, '');
            break;
        }

        await editMessage(chat_id, message_id, text);
        await answerCallback(cb.id);
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      console.error(err);
      return new Response('Internal Error', { status: 500 });
    }
  },
};
