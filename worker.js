
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
      const TELEGRAM_TOKEN = "8321034986:AAFsu8feD7r3Se8o9-lPSQdhSnhQY6tAI5E"; // en wrangler usar secrets
      const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
      const apiUrl = TELEGRAM_API;

      // Función helper para enviar mensajes
      const sendMessage = async (chat_id, text, options = {}) => {
        await fetch(`${apiUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, text, ...options }),
        });
      };

      // Función helper para editar mensajes
      const editMessage = async (chat_id, message_id, text, options = {}) => {
        await fetch(`${apiUrl}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id, message_id, text, ...options }),
        });
      };

      // Función helper para responder callback
      const answerCallback = async (callback_query_id, text = '') => {
        await fetch(`${apiUrl}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id, text }),
        });
      };

      // --- Process Message ---
      if (body.message) {
        const msg = body.message;
        const chat_id = msg.chat.id;
        const user = msg.from.username || msg.from.first_name;

        // Solo procesamos mensajes que comienzan con "Remesa"
        if (msg.text && msg.text.startsWith('Remesa')) {
          const parts = msg.text.split(' ');
          if (parts.length >= 3) {
            const sent = parseFloat(parts[1]);
            const given = parseFloat(parts[2]);
            const gain = given - sent;
            const commission = +(gain * 0.2).toFixed(2);

            // Construir texto nuevo
            let text = `${msg.text}\nGanancia: $${gain}\nComision ${user}: $${commission}\nFecha: ${new Date().toLocaleDateString('en-GB')}`;

            // Botones inline
            const reply_markup = {
              inline_keyboard: [
                [
                  { text: 'Confirmar ✅', callback_data: 'confirm' },
                  { text: 'Entregado 😊', callback_data: 'delivered' },
                ],
              ],
            };

            // Si el mensaje tiene foto, mantenemos la foto
            if (msg.photo && msg.photo.length > 0) {
              const file_id = msg.photo[msg.photo.length - 1].file_id; // mejor resolución
              await fetch(`${apiUrl}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id,
                  photo: file_id,
                  caption: text,
                  reply_markup,
                }),
              });
              // Borramos mensaje original si tenemos permisos
              try {
                await fetch(`${apiUrl}/deleteMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id, message_id: msg.message_id }),
                });
              } catch (err) {
                console.log('No se pudo borrar mensaje original', err);
              }
            } else {
              // Solo texto
              await sendMessage(chat_id, text, { reply_markup });
              // Borrar original
              try {
                await fetch(`${apiUrl}/deleteMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id, message_id: msg.message_id }),
                });
              } catch (err) {
                console.log('No se pudo borrar mensaje original', err);
              }
            }
          }
        }
      }

      // --- Process Callback ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;

        let new_text = cb.message.text;

        if (cb.data === 'confirm') {
          new_text += `\nConfirmado: ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
        } else if (cb.data === 'delivered') {
          new_text += `\nEntregado: ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`;
        }

        await editMessage(chat_id, message_id, new_text);
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


