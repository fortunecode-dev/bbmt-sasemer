// src/index.js
// Worker que usa el propio chat como "base de datos" (texto plano, sin Markdown).
// Requisitos: env.TELEGRAM_TOKEN configurado; bot admin con permiso Pin Messages.

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'GET') return new Response('Worker OK', { status: 200 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      // parse body
      let body;
      try { body = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
      if (!body) return new Response('No body', { status: 400 });

      const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN;
      if (!TELEGRAM_TOKEN) return new Response('Missing TELEGRAM_TOKEN', { status: 500 });
      const API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

      // small helper to call Telegram methods via POST
      const tg = async (method, payload = {}) => {
        const res = await fetch(`${API}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return res.json();
      };

      // get pinned message via getChat
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

      const pinChatMessage = async (chat_id, message_id) => {
        return tg('pinChatMessage', { chat_id, message_id, disable_notification: true });
      };

      // create and pin a new summary message for the month (plain text)
      const createAndPinSummary = async (chat_id, monthLabel, initialData = {}) => {
        const header = `Resumen de remesas — ${monthLabel}`;
        const humanLines = Object.entries(initialData).length > 0
          ? Object.entries(initialData).map(([u, v]) => `${u}: Ganancia $${v.gain.toFixed(2)} — Comisión $${v.commission.toFixed(2)} (${v.count})`)
          : ['No hay remesas registradas aún.'];
        const jsonPayload = JSON.stringify({ month: monthLabel, data: initialData });
        const storageBlock = `\n\n---SUMMARY_JSON---\n${jsonPayload}\n---END_SUMMARY_JSON---`;
        const text = `${header}\n\n${humanLines.join('\n')}${storageBlock}`;
        const sent = await tg('sendMessage', { chat_id, text, disable_notification: true });
        if (sent && sent.ok && sent.result && sent.result.message_id) {
          await pinChatMessage(chat_id, sent.result.message_id);
          return sent.result;
        }
        return null;
      };

      // parse JSON block from pinned message text
      const parsePinnedSummary = (pinnedText) => {
        if (!pinnedText) return null;
        const startMarker = '---SUMMARY_JSON---';
        const endMarker = '---END_SUMMARY_JSON---';
        const si = pinnedText.indexOf(startMarker);
        if (si === -1) return null;
        const after = pinnedText.slice(si + startMarker.length);
        const ei = after.indexOf(endMarker);
        if (ei === -1) return null;
        const jsonRaw = after.slice(0, ei).trim();
        try {
          return JSON.parse(jsonRaw);
        } catch (err) {
          console.error('Error parsing pinned json', err);
          return null;
        }
      };

      // update or create pinned summary by incrementing the user's totals
      const upsertSummaryInChat = async (chat_id, username, gain, commission) => {
        const pinned = await getPinnedMessage(chat_id);
        // determine month label in America/Los_Angeles
        const laString = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const la = new Date(laString);
        const monthLabel = la.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' });

        let summary = null;
        if (pinned && pinned.text) summary = parsePinnedSummary(pinned.text);

        if (!summary || summary.month !== monthLabel) {
          // create initial
          const init = {};
          init[username] = { gain: Number(gain), commission: Number(commission), count: 1 };
          await createAndPinSummary(chat_id, monthLabel, init);
          return;
        }

        const data = summary.data || {};
        if (!data[username]) data[username] = { gain: 0, commission: 0, count: 0 };
        data[username].gain = Number(data[username].gain || 0) + Number(gain || 0);
        data[username].commission = Number(data[username].commission || 0) + Number(commission || 0);
        data[username].count = (data[username].count || 0) + 1;

        // rebuild text
        const header = `Resumen de remesas — ${summary.month}`;
        const humanLines = Object.entries(data).map(([u, v]) => `${u}: Ganancia $${(v.gain).toFixed(2)} — Comisión $${(v.commission).toFixed(2)} (${v.count})`);
        const jsonPayload = JSON.stringify({ month: summary.month, data });
        const storageBlock = `\n\n---SUMMARY_JSON---\n${jsonPayload}\n---END_SUMMARY_JSON---`;
        const newText = `${header}\n\n${humanLines.join('\n')}${storageBlock}`;

        try {
          await tg('editMessageText', { chat_id, message_id: pinned.message_id, text: newText, disable_notification: true });
        } catch (err) {
          console.error('Failed editing pinned summary', err);
        }
      };

      // ----------------- MAIN: handle incoming updates -----------------
      // 1) Incoming message -> detect Remesa and update pinned summary
      if (body.message) {
        const msg = body.message;
        const chat_id = msg.chat.id;
        const from = msg.from || {};
        const username = from.username ? `@${from.username}` : `${(from.first_name || '')} ${(from.last_name || '')}`.trim() || String(from.id || '');
        const textCandidate = (msg.text || msg.caption || '').trim();

        if (/^\s*Remesa\s+/i.test(textCandidate)) {
          const parts = textCandidate.split(/\s+/);
          if (parts.length >= 3) {
            const sent = parseFloat(parts[1].replace(',', '.')) || 0;
            const given = parseFloat(parts[2].replace(',', '.')) || 0;
            const client = parts.slice(3).join(' ') || 'Cliente';
            const gain = Math.abs(given - sent);
            const commission = +(gain * 0.2).toFixed(2);

            // human-friendly text (plain)
            const humanText =
              `Cliente: ${client}\nRemesa: ${sent} -> ${given}\nGanancia: $${gain.toFixed(2)}\nComision: $${commission.toFixed(2)} (${username})\nFecha: ${new Date(msg.date * 1000).toLocaleDateString('en-GB')}`;

            const reply_markup = {
              inline_keyboard: [
                [{ text: 'Confirmar', callback_data: 'confirm' }, { text: 'Deshacer Confirmar', callback_data: 'undo_confirm' }],
                [{ text: 'Entregado', callback_data: 'delivered' }, { text: 'Deshacer Entregado', callback_data: 'undo_delivered' }],
              ],
            };

            // send ficha (plain text), silent by default
            await tg('sendMessage', { chat_id, text: humanText, reply_markup, disable_notification: true });

            // update pinned "DB"
            await upsertSummaryInChat(chat_id, username, gain, commission);

            // optionally delete original message for cleanliness
            try { await tg('deleteMessage', { chat_id, message_id: msg.message_id }); } catch (e) { /* ignore */ }

            return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
          }
        }

        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
      }

      // 2) callback_query: edit the visible message (no changes to pinned summary)
      if (body.callback_query) {
        const cb = body.callback_query;
        const chat_id = cb.message.chat.id;
        const message_id = cb.message.message_id;
        let lines = (cb.message.text || '').split('\n').map(l => l.trim()).filter(Boolean);

        const hasConfirmed = lines.some(l => /Confirmado/.test(l));
        const hasDelivered = lines.some(l => /Entregado/.test(l));

        switch (cb.data) {
          case 'confirm':
            if (!hasConfirmed) lines.push(`Confirmado: ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
            break;
          case 'undo_confirm':
            lines = lines.filter(l => !/Confirmado/.test(l));
            break;
          case 'delivered':
            if (!hasDelivered) lines.push(`Entregado: ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
            break;
          case 'undo_delivered':
            lines = lines.filter(l => !/Entregado/.test(l));
            break;
        }

        const nowHasConfirmed = lines.some(l => /Confirmado/.test(l));
        const nowHasDelivered = lines.some(l => /Entregado/.test(l));
        const inline_keyboard = [
          nowHasConfirmed ? [{ text: 'Deshacer Confirmar', callback_data: 'undo_confirm' }] : [{ text: 'Confirmar', callback_data: 'confirm' }],
          nowHasDelivered ? [{ text: 'Deshacer Entregado', callback_data: 'undo_delivered' }] : [{ text: 'Entregado', callback_data: 'delivered' }],
        ];

        const new_text = lines.join('\n');
        await tg('editMessageText', { chat_id, message_id, text: new_text, reply_markup: { inline_keyboard }, disable_notification: true });
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
