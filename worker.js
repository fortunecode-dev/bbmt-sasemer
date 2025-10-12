// src/index.js
export default {
  async fetch(request, env, ctx) {
    try {
      // GET → Health check
      if (request.method === 'GET') {
        return new Response('Worker OK', { status: 200 });
      }

      // Solo parsea POST
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }

      let body;
      try {
        body = await request.json();
      } catch (err) {
        return new Response('Invalid JSON', { status: 400 });
      }

      if (!body) return new Response('No body', { status: 400 });

      // --- Telegram Update Handling ---
      const TELEGRAM_TOKEN = "8321034986:AAFsu8feD7r3Se8o9-lPSQdhSnhQY6tAI5E";
      const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

      const sendMessage = async (chat_id, text, options = {}) => {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, parse_mode: "MarkdownV2", ...options }),
        });
      };

      const editMessage = async (chat_id, message_id, text, options = {}) => {
        await fetch(`${TELEGRAM_API}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, message_id, text, parse_mode: "MarkdownV2", ...options }),
        });
      };

      const answerCallback = async (callback_query_id, text = '') => {
        await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id, text }),
        });
      };

      const escapeMarkdown = (text) => {
        // Escapa caracteres especiales de MarkdownV2
        return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
      };

      const getReplyMarkup = (confirmed, delivered) => {
        return {
          inline_keyboard: [
            [
              confirmed
                ? { text: '❌ Deshacer Confirmar', callback_data: 'undo_confirm' }
                : { text: '✅ Confirmar', callback_data: 'confirm' },
              delivered
                ? { text: '❌ Deshacer Entregado', callback_data: 'undo_delivered' }
                : { text: '📦 Entregado', callback_data: 'delivered' },
            ],
          ],
        };
      };

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
            const gain = Math.abs(given - sent);
            const commission = +(gain * 0.2).toFixed(2);
            const client = parts.slice(3).join(' ') || "Cliente";

            const text = `*Cliente:* ${escapeMarkdown(client)}
*Remesa:* ${sent} ➡️ ${given}
*Ganancia:* $${gain}
*Comision:* $${commission} (@${escapeMarkdown(user)})
*Fecha:* ${new Date().toLocaleDateString('en-GB')}`;

            const reply_markup = getReplyMarkup(false, false); // inicial sin confirmar ni entregado
            await sendMessage(chat_id, text, { reply_markup });
          }
        }
      }

      // --- Process Callback ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;
        let new_text = cb.message.text;

        const isConfirmed = new_text.includes('*Confirmado*');
        const isDelivered = new_text.includes('*Entregado*');

        if (cb.data === 'confirm' && !isConfirmed) {
          new_text += `\n*Confirmado*: ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
        } else if (cb.data === 'undo_confirm' && isConfirmed) {
          new_text = new_text.replace(/\n\*Confirmado\*:.*$/, '');
        } else if (cb.data === 'delivered' && !isDelivered) {
          new_text += `\n*Entregado*: ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
        } else if (cb.data === 'undo_delivered' && isDelivered) {
          new_text = new_text.replace(/\n\*Entregado\*:.*$/, '');
        }

        const reply_markup = getReplyMarkup(
          new_text.includes('*Confirmado*'),
          new_text.includes('*Entregado*')
        );

        await editMessage(chat_id, message_id, new_text, { reply_markup });
        await answerCallback(cb.id);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (err) {
      console.error(err);
      return new Response('Internal Error', { status: 500 });
    }
  },
};
