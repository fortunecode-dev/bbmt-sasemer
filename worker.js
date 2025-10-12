// worker.js (Cloudflare Worker)
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

const TELEGRAM_TOKEN = TELEGRAM_TOKEN_PLACEHOLDER; // en wrangler usar secrets
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// helpers
const pad2 = (n) => n.toString().padStart(2, '0');
function formatDate(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; }
function formatDateTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())} ${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; }

function parseRemesa(text) {
  if (!text) return null;
  const re = /^\s*Remesa\s+([0-9]+(?:[.,][0-9]+)?)\s+([0-9]+(?:[.,][0-9]+)?)\s*(.*)$/i;
  const m = text.match(re);
  if (!m) return null;
  const toNum = s => parseFloat(s.replace(',', '.'));
  return { sent: toNum(m[1]), given: toNum(m[2]), rest: m[3]?.trim() || '' };
}

function buildText(parsed, userLabel) {
  const diff = parsed.sent - parsed.given;
  const diffStr = (Math.round(diff*100)/100).toFixed(2);
  const commission = diff * 0.2;
  const commStr = (Math.round(commission*100)/100).toFixed(2);
  const date = formatDate(new Date());
  const originalLine = `Mensaje: Remesa ${parsed.sent} ${parsed.given}${parsed.rest ? ' ' + parsed.rest : ''}`;
  return `${originalLine}\nGanancia: $${diffStr}\nComisión ${userLabel} $${commStr}\nFecha: ${date}`;
}

async function telegramAPI(method, bodyObj) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj)
  });
  return res.json();
}

async function handleRequest(req) {
  try {
    const body = await req.json();
    // Telegram sends many different updates; procesamos message y callback_query
    if (body.message) {
      const msg = body.message;
      const textCandidate = msg.text || msg.caption || '';
      const parsed = parseRemesa(textCandidate);
      if (!parsed) return new Response(JSON.stringify({ ok: true }), { status: 200 });

      const from = msg.from || {};
      const userLabel = from.username ? `@${from.username}` : `${from.first_name || ''}${from.last_name ? ' ' + from.last_name : ''}`.trim() || `${from.id}`;

      const enrichedText = buildText(parsed, userLabel);

      // Intentar borrar el mensaje original
      try {
        await telegramAPI('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id });
      } catch (err) {
        // ignore - puede fallar si no hay permisos
        console.warn('deleteMessage fallo', err);
      }

      // si hay foto
      if (msg.photo && Array.isArray(msg.photo) && msg.photo.length) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        await telegramAPI('sendPhoto', {
          chat_id: msg.chat.id,
          photo: fileId,
          caption: enrichedText,
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Confirmar ✅', callback_data: 'action_confirm' }, { text: 'Entregado 😊', callback_data: 'action_delivered' }]
            ]
          }
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // si es document tipo imagen
      if (msg.document && msg.document.mime_type && msg.document.file_id) {
        const mime = msg.document.mime_type;
        if (mime.startsWith('image/')) {
          await telegramAPI('sendDocument', {
            chat_id: msg.chat.id,
            document: msg.document.file_id,
            caption: enrichedText,
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Confirmar ✅', callback_data: 'action_confirm' }, { text: 'Entregado 😊', callback_data: 'action_delivered' }]
              ]
            }
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
      }

      // fallback: texto
      await telegramAPI('sendMessage', {
        chat_id: msg.chat.id,
        text: enrichedText,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Confirmar ✅', callback_data: 'action_confirm' }, { text: 'Entregado 😊', callback_data: 'action_delivered' }]
          ]
        }
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (body.callback_query) {
      const cb = body.callback_query;
      const data = cb.data;
      const msg = cb.message;
      const isMedia = !!(msg.photo || msg.document);
      const currentText = msg.caption ?? msg.text ?? '';
      const now = new Date();
      if (data === 'action_confirm') {
        if (currentText.includes('Confirmado:')) {
          await telegramAPI('answerCallbackQuery', { callback_query_id: cb.id, text: 'Ya estaba confirmado.', show_alert: false });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        const newText = `${currentText}\nConfirmado: ${formatDateTime(now)}`;
        if (isMedia) {
          await telegramAPI('editMessageCaption', { chat_id: msg.chat.id, message_id: msg.message_id, caption: newText });
        } else {
          await telegramAPI('editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text: newText });
        }
        await telegramAPI('answerCallbackQuery', { callback_query_id: cb.id, text: 'Marcado como confirmado ✅' });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (data === 'action_delivered') {
        if (currentText.includes('Entregado:')) {
          await telegramAPI('answerCallbackQuery', { callback_query_id: cb.id, text: 'Ya estaba entregado.', show_alert: false });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        const newText = `${currentText}\nEntregado: ${formatDateTime(now)}`;
        if (isMedia) {
          await telegramAPI('editMessageCaption', { chat_id: msg.chat.id, message_id: msg.message_id, caption: newText });
        } else {
          await telegramAPI('editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, text: newText });
        }
        await telegramAPI('answerCallbackQuery', { callback_query_id: cb.id, text: 'Marcado como entregado 😊' });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    // default
    return new Response(JSON.stringify({ ok: true }), { status: 200 });

  } catch (err) {
    console.error('worker error', err);
    return new Response('ok', { status: 200 });
  }
}
