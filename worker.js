// src/index.js
export default {
  async fetch(request, env, ctx) {
    const TELEGRAM_TOKEN = "8321034986:AAFsu8feD7r3Se8o9-lPSQdhSnhQY6tAI5E"; // usar secrets en producción
    const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

    const sendMessage = async (chat_id, text, options = {}) => {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, ...options }),
      });
    };

    const editMessage = async (chat_id, message_id, text, options = {}) => {
      await fetch(`${TELEGRAM_API}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, message_id, text, ...options }),
      });
    };

    const answerCallback = async (callback_query_id, text = '') => {
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id, text }),
      });
    };

    try {
      if (request.method === 'GET') return new Response('Worker OK', { status: 200 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response('Invalid JSON', { status: 400 });
      }
      if (!body) return new Response('No body', { status: 400 });

      // --- Process Message ---
      if (body.message) {
        const msg = body.message;
        const chat_id = msg.chat.id;
        const user = msg.from.username || msg.from.first_name;

        if (msg.text && msg.text.startsWith('Remesa')) {
          const parts = msg.text.split(' ');
          if (parts.length >= 3) {
            const sent = parseFloat(parts[1]);
            const given = parseFloat(parts[2]);
            const client = parts.slice(3).join(' ') || 'Cliente';
            const gain = given - sent;
            const commission = +(gain * 0.2).toFixed(2);

            let text = `**Cliente:** ${client}\n**Remesa:** ${sent} ➡️ ${given}\n**Ganancia:** $${gain}\n**Comisión:** $${commission} (@${user})\n**Fecha:** ${new Date().toLocaleDateString('en-GB')}`;

            const reply_markup = {
              inline_keyboard: [
                [
                  { text: 'Confirmar ✅', callback_data: 'confirm' },
                  { text: 'Deshacer Confirmar ❌', callback_data: 'undo_confirm' },
                ],
                [
                  { text: 'Entregado 📦', callback_data: 'delivered' },
                  { text: 'Deshacer Entregado ❌', callback_data: 'undo_delivered' },
                ],
              ],
            };

            await sendMessage(chat_id, text, { reply_markup, parse_mode: 'Markdown' });
          }
        }
      }

      // --- Process Callback ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;
        let new_text = cb.message.text;

        if (cb.data === 'confirm') new_text += `\n**Confirmado ✅**`;
        if (cb.data === 'undo_confirm') new_text = new_text.replace(/\*\*Confirmado ✅\*\*/, '');
        if (cb.data === 'delivered') new_text += `\n**Entregado 📦**`;
        if (cb.data === 'undo_delivered') new_text = new_text.replace(/\*\*Entregado 📦\*\*/, '');

        await editMessage(chat_id, message_id, new_text, { parse_mode: 'Markdown' });
        await answerCallback(cb.id);
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      console.error(err);
      // Enviar el error al chat principal si body.message existe
      try {
        const chat_id = (body?.message?.chat?.id) || env.ADMIN_CHAT_ID;
        if (chat_id) {
          await sendMessage(chat_id, `⚠️ Error en worker:\n\`\`\`${err.message}\`\`\``, { parse_mode: 'Markdown' });
        }
      } catch (e) {
        console.error('No se pudo enviar el error al chat', e);
      }

      return new Response('Internal Error', { status: 500 });
    }
  },
};
