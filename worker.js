// src/index.js
// Worker: usa el chat como DB (pinned message) y reporta errores en el chat/ADMIN_CHAT_ID.
// Sin Markdown, texto plano.

export default {
  async fetch(request, env, ctx) {
    // Helper tg
    const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN;
    const API = TELEGRAM_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_TOKEN}` : null;

    const tg = async (method, payload = {}) => {
      if (!API) return { ok: false, error: 'No TELEGRAM_TOKEN' };
      try {
        const res = await fetch(`${API}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return await res.json();
      } catch (e) {
        console.error('tg call failed', method, e);
        return { ok: false, error: String(e) };
      }
    };

    // Safe send error report to a chat (chat_id when available, fallback ADMIN_CHAT_ID)
    const reportErrorToChat = async (chat_id, title, err, bodySnippet = null) => {
      try {
        const admin = env.ADMIN_CHAT_ID;
        const target = chat_id || admin;
        if (!target) {
          console.error('No chat to report error to (no chat_id and ADMIN_CHAT_ID not set)');
          return;
        }
        const messageLines = [];
        messageLines.push('⚠️ ERROR en el bot');
        messageLines.push(`Tipo: ${title}`);
        messageLines.push(`Mensaje: ${err && err.message ? err.message : String(err)}`);
        if (err && err.stack) {
          // recortar stack para no enviar demasiado
          messageLines.push('Stack:');
          messageLines.push(String(err.stack).split('\n').slice(0, 6).join('\n'));
        }
        if (bodySnippet) {
          messageLines.push('Contexto:');
          messageLines.push(bodySnippet);
        }
        messageLines.push('(Este mensaje fue enviado automáticamente por el bot)');

        const text = messageLines.join('\n');
        await tg('sendMessage', { chat_id: target, text, disable_notification: false });
      } catch (e2) {
        // No más esfuerzo — solo loguear.
        console.error('Failed to report error to chat', e2);
      }
    };

    try {
      if (request.method === 'GET') return new Response('Worker OK', { status: 200 });
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

      // parse body
      let body;
      try { body = await request.json(); } catch (parseErr) {
        // No podemos parsear; intentar reportar al ADMIN_CHAT_ID
        await reportErrorToChat(null, 'Invalid JSON', parseErr, null);
        return new Response('Invalid JSON', { status: 400 });
      }
      if (!body) return new Response('No body', { status: 400 });

      // Context chat_id for potential error reporting
      let contextChatId = null;
      if (body.message && body.message.chat && body.message.chat.id) contextChatId = body.message.chat.id;
      if (body.callback_query && body.callback_query.message && body.callback_query.message.chat && body.callback_query.message.chat.id) contextChatId = body.callback_query.message.chat.id;

      // --- helpers and pinned summary functions (same as before) ---
      const getPinnedMessage = async (chat_id) => {
        return await tg('getChat', { chat_id }).then(j => (j && j.ok ? j.result.pinned_message ?? null : null)).catch(() => null);
      };

      const pinChatMessage = async (chat_id, message_id) => {
        return await tg('pinChatMessage', { chat_id, message_id, disable_notification: true });
      };

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
        try { return JSON.parse(jsonRaw); } catch (err) { console.error('parsePinnedSummary failed', err); return null; }
      };

      const upsertSummaryInChat = async (chat_id, username, gain, commission) => {
        const pinned = await getPinnedMessage(chat_id);
        const laString = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        const la = new Date(laString);
        const monthLabel = la.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' });

        let summary = null;
        if (pinned && pinned.text) summary = parsePinnedSummary(pinned.text);

        if (!summary || summary.month !== monthLabel) {
          const init = {};
          init[username] = { gain: Number(gain), commission: Number(commission), count: 1 };
          const created = await createAndPinSummary(chat_id, monthLabel, init);
          return created;
        }

        const data = summary.data || {};
        if (!data[username]) data[username] = { gain: 0, commission: 0, count: 0 };
        data[username].gain = Number(data[username].gain || 0) + Number(gain || 0);
        data[username].commission = Number(data[username].commission || 0) + Number(commission || 0);
        data[username].count = (data[username].count || 0) + 1;

        const header = `Resumen de remesas — ${summary.month}`;
        const humanLines = Object.entries(data).map(([u, v]) => `${u}: Ganancia $${(v.gain).toFixed(2)} — Comisión $${(v.commission).toFixed(2)} (${v.count})`);
        const jsonPayload = JSON.stringify({ month: summary.month, data });
        const storageBlock = `\n\n---SUMMARY_JSON---\n${jsonPayload}\n---END_SUMMARY_JSON---`;
        const newText = `${header}\n\n${humanLines.join('\n')}${storageBlock}`;

        try {
          await tg('editMessageText', { chat_id, message_id: pinned.message_id, text: newText, disable_notification: true });
          return true;
        } catch (err) {
          console.error('Failed editing pinned summary', err);
          // report error to chat
          await reportErrorToChat(chat_id, 'Failed editing pinned summary', err, JSON.stringify({ chat_id, pinned_message_id: pinned ? pinned.message_id : null }).slice(0, 1000));
          return null;
        }
      };

      // ----------------- MAIN processing -----------------
      try {
        // 1) incoming message: detect Remesa
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

              const humanText =
                `Cliente: ${client}\nRemesa: ${sent} -> ${given}\nGanancia: $${gain.toFixed(2)}\nComision: $${commission.toFixed(2)} (${username})\nFecha: ${new Date(msg.date * 1000).toLocaleDateString('en-GB')}`;

              const reply_markup = {
                inline_keyboard: [
                  [{ text: 'Confirmar', callback_data: 'confirm' }, { text: 'Deshacer Confirmar', callback_data: 'undo_confirm' }],
                  [{ text: 'Entregado', callback_data: 'delivered' }, { text: 'Deshacer Entregado', callback_data: 'undo_delivered' }],
                ],
              };

              await tg('sendMessage', { chat_id, text: humanText, reply_markup, disable_notification: true });

              // update pinned summary; if it errors, upsertSummaryInChat will report
              await upsertSummaryInChat(chat_id, username, gain, commission);

              // try delete original
              try { await tg('deleteMessage', { chat_id, message_id: msg.message_id }); } catch (e) { /* ignore */ }

              return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
            }
          }
          // not a remesa - nothing to do
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
        }

        // 2) callback_query handling (edit visible message only)
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

      } catch (innerErr) {
        // Error while processing specific update: report to chat (use contextChatId if possible)
        const bodyStr = (() => { try { return JSON.stringify(body).slice(0, 1000); } catch (e) { return null; } })();
        await reportErrorToChat(contextChatId, 'Processing error', innerErr, bodyStr);
        console.error('Processing error:', innerErr);
        return new Response('Internal Error', { status: 500 });
      }

    } catch (err) {
      // Top-level error: try to report to ADMIN_CHAT_ID
      console.error('Worker top-level error:', err);
      try { await reportErrorToChat(null, 'Worker top-level error', err, null); } catch (e) { console.error('Failed reporting top-level error', e); }
      return new Response('Internal Error', { status: 500 });
    }
  },
};
