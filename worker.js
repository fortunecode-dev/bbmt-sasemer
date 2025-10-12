// src/index.js
// Worker que usa el propio chat como "base de datos".
// Requisitos: bot admin con permiso Pin Messages, env.TELEGRAM_TOKEN secret configurado.

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'GET') return new Response('Worker OK', { status: 200 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      // parsear body
      let body;
      try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!body) return new Response('No body', { status: 400 });

      const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN;
      if (!TELEGRAM_TOKEN) return new Response('Missing TELEGRAM_TOKEN', { status: 500 });
      const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

      // helpers Telegram
      const tg = async (method, payload = {}) => {
        const res = await fetch(`${API}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return res.json();
      };

      const escapeMdV2 = (s = '') =>
        s.toString().replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

      // obtiene pinned_message (si existe) mediante getChat
      const getPinnedMessage = async (chat_id) => {
        const res = await fetch(`${API}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id }),
        });
        const j = await res.json();
        if (!j.ok) return null;
        return j.result.pinned_message ?? null;
      };

      // fija un mensaje por chat_id/message_id
      const pinChatMessage = async (chat_id, message_id) => {
        return tg('pinChatMessage', { chat_id, message_id, disable_notification: true });
      };

      // crea el texto legible + JSON embebido y lo publica, luego lo fija
      const createAndPinSummary = async (chat_id, monthLabel, initialData = {}) => {
        // initialData: { username: { gain: x, commission: y, count: n }, ... }
        const header = `*Resumen de remesas — ${escapeMdV2(monthLabel)}*`;
        const humanLines = Object.entries(initialData).length > 0
          ? Object.entries(initialData).map(([u, v]) => `${escapeMdV2(u)}: Ganancia $${v.gain.toFixed(2)} — Comisión $${v.commission.toFixed(2)} (${v.count})`)
          : ['_No hay remesas registradas aún._'];
        const jsonPayload = JSON.stringify({ month: monthLabel, data: initialData });
        // metemos el JSON entre marcadores para parseo
        const storageBlock = `\n\n\`\`\`SUMMARY_JSON\n${escapeMdV2(jsonPayload)}\n\`\`\``;
        const text = `${header}\n\n${humanLines.join('\n')}${storageBlock}`;
        const sent = await tg('sendMessage', { chat_id, text, parse_mode: 'MarkdownV2', disable_notification: true });
        if (sent && sent.ok && sent.result && sent.result.message_id) {
          await pinChatMessage(chat_id, sent.result.message_id);
          return sent.result;
        }
        return null;
      };

      // parsea el JSON embebido dentro del pinned_message.text; devuelve {month, data} o null
      const parsePinnedSummary = (pinnedText) => {
        if (!pinnedText) return null;
        // buscamos el bloque ```SUMMARY_JSON\n...```
        const markerStart = '```SUMMARY_JSON';
        const markerEnd = '```';
        const si = pinnedText.indexOf(markerStart);
        if (si === -1) return null;
        const after = pinnedText.slice(si + markerStart.length);
        const ei = after.indexOf(markerEnd);
        if (ei === -1) return null;
        const jsonEscaped = after.slice(0, ei).trim();
        // To parse, debemos un-escape MarkdownV2 chars (invertir escape: remove backslashes)
        const unescaped = jsonEscaped.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1');
        try {
          const parsed = JSON.parse(unescaped);
          return parsed;
        } catch (err) {
          console.error('Error parsing pinned json', err);
          return null;
        }
      };

      // actualiza (incrementa) el summary en el pinned message: suma gain/commission por username
      const upsertSummaryInChat = async (chat_id, username, gain, commission, messageDateISO) => {
        // obtener pinned_message
        const pinned = await getPinnedMessage(chat_id);
        // decidir label mes local (America/Los_Angeles)
        const laNow = new Date();
        const laStr = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const la = new Date(laStr);
        const monthLabel = la.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' });

        let summary = null;
        if (pinned && pinned.text) summary = parsePinnedSummary(pinned.text);

        // si no hay summary o month != monthLabel creamos uno nuevo con initial row
        if (!summary || summary.month !== monthLabel) {
          const init = {};
          init[username] = { gain: Number(gain), commission: Number(commission), count: 1 };
          const created = await createAndPinSummary(chat_id, monthLabel, init);
          return created;
        }

        // tenemos summary.data, actualizar
        const data = summary.data || {};
        if (!data[username]) data[username] = { gain: 0, commission: 0, count: 0 };
        data[username].gain = Number(data[username].gain || 0) + Number(gain || 0);
        data[username].commission = Number(data[username].commission || 0) + Number(commission || 0);
        data[username].count = (data[username].count || 0) + 1;

        // reconstruir texto human y json block
        const header = `*Resumen de remesas — ${escapeMdV2(summary.month)}*`;
        const humanLines = Object.entries(data).map(([u, v]) => `${escapeMdV2(u)}: Ganancia $${(v.gain).toFixed(2)} — Comisión $${(v.commission).toFixed(2)} (${v.count})`);
        const jsonPayload = JSON.stringify({ month: summary.month, data });
        const storageBlock = `\n\n\`\`\`SUMMARY_JSON\n${escapeMdV2(jsonPayload)}\n\`\`\``;
        const newText = `${header}\n\n${humanLines.join('\n')}${storageBlock}`;

        // editar el pinned message (pinned.message_id)
        try {
          // si pinned exists use its message_id
          await tg('editMessageText', { chat_id, message_id: pinned.message_id, text: newText, parse_mode: 'MarkdownV2', disable_notification: true });
          return true;
        } catch (err) {
          console.error('Failed editing pinned summary', err);
          return null;
        }
      };

      // ---------- MAIN: procesar remesa (sincronamente) ----------
      if (body.message) {
        const msg = body.message;
        const chat_id = msg.chat.id;
        const from = msg.from || {};
        const username = (from.username) ? `@${from.username}` : `${from.first_name || ''} ${from.last_name || ''}`.trim() || String(from.id || '');
        const userId = from.id || null;
        const textCandidate = (msg.text || msg.caption || '').trim();

        // sólo remesas
        if (/^\s*Remesa\s+/i.test(textCandidate)) {
          const parts = textCandidate.split(/\s+/);
          if (parts.length >= 3) {
            const sent = parseFloat(parts[1].replace(',', '.')) || 0;
            const given = parseFloat(parts[2].replace(',', '.')) || 0;
            const client = parts.slice(3).join(' ') || 'Cliente';
            const gain = Math.abs(given - sent);
            const commission = +(gain * 0.2).toFixed(2);

            // enviar ficha legible al grupo (silenciosa)
            const md = `*Cliente:* ${escapeMdV2(client)}\n*Remesa:* ${escapeMdV2(String(sent))} ➡️ ${escapeMdV2(String(given))}\n*Ganancia:* $${escapeMdV2(gain.toFixed(2))}\n*Comisión:* $${escapeMdV2(commission.toFixed(2))} (${escapeMdV2(username)})\n*Fecha:* ${new Date(msg.date * 1000).toLocaleDateString('en-GB')}`;

            const reply_markup = {
              inline_keyboard: [
                [{ text: '✅ Confirmar', callback_data: 'confirm' }, { text: '⚠️ Deshacer Confirmar', callback_data: 'undo_confirm' }],
                [{ text: '📦 Entregado', callback_data: 'delivered' }, { text: '⚠️ Deshacer Entregado', callback_data: 'undo_delivered' }],
              ],
            };

            await tg('sendMessage', { chat_id, text: md, parse_mode: 'MarkdownV2', reply_markup, disable_notification: true });

            // actualizar el summary embebido en pinned message
            await upsertSummaryInChat(chat_id, username, gain, commission, new Date(msg.date * 1000).toISOString());

            // intentar borrar el original para limpieza (opcional)
            try {
              await tg('deleteMessage', { chat_id, message_id: msg.message_id });
            } catch (err) { /* ignore */ }

            return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
          }
        }

        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // --- callbacks (mantengo simple: sólo editar mensaje visible, no tocar summary) ---
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;
        let lines = (cb.message.text || '').split('\n').map(l => l.trim()).filter(Boolean);

        const hasConfirmed = lines.some(l => /Confirmado/.test(l));
        const hasDelivered = lines.some(l => /Entregado/.test(l));

        switch (cb.data) {
          case 'confirm':
            if (!hasConfirmed) lines.push(`*✅ Confirmado:* ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
            break;
          case 'undo_confirm':
            lines = lines.filter(l => !/✅ Confirmado/.test(l));
            break;
          case 'delivered':
            if (!hasDelivered) lines.push(`*📦 Entregado:* ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
            break;
          case 'undo_delivered':
            lines = lines.filter(l => !/📦 Entregado/.test(l));
            break;
        }

        // teclado dinámico: acción o undo por pareja
        const nowHasConfirmed = lines.some(l => /✅ Confirmado/.test(l));
        const nowHasDelivered = lines.some(l => /📦 Entregado/.test(l));
        const inline_keyboard = [
          nowHasConfirmed ? [{ text: '⚠️ ❌ Deshacer Confirmar', callback_data: 'undo_confirm' }] : [{ text: '✅ Confirmar', callback_data: 'confirm' }],
          nowHasDelivered ? [{ text: '⚠️ ❌ Deshacer Entregado', callback_data: 'undo_delivered' }] : [{ text: '📦 Entregado', callback_data: 'delivered' }],
        ];

        const new_text = lines.join('\n');
        await tg('editMessageText', { chat_id, message_id: message_id, text: new_text, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard }, disable_notification: true });
        await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '' });
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // fallback
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
      console.error('Worker error:', err);
      return new Response('Internal Error', { status: 500 });
    }
  },
};
