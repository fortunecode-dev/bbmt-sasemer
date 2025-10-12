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
            const pinMessage = (chat_id,message_id, options = {}) =>
                fetch(`${API}/pinChatMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, text,message_id, parse_mode: 'Markdown', ...options }) });

            const editMessage = (chat_id, message_id, text, options = {}) =>
                fetch(`${API}/editMessageText`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, message_id, text, parse_mode: 'Markdown', "disable_notification": true, ...options }) });

            const answerCallback = (callback_query_id, text = '') =>
                fetch(`${API}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id, text, "disable_notification": true }) });

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
                    const clientName = parts.slice(3).join(' ') || 'Cliente';
                    const gain = Math.abs(given - sent);
                    const commission = +(gain * 0.2).toFixed(2);

                    const text = `
**Confirma ${sent}**
**Cliente:** ${clientName}
**Remesa:** ${sent} ➡️ ${given}
**Ganancia:** $${gain}
**Comisión:** $${commission} (${mention})
**Fecha:** ${new Date().toLocaleDateString('en-GB')}`;

                    const reply_markup = {
                        inline_keyboard: [
                            [{ text: '✅ Confirmar', callback_data: 'confirm' }],
                            [{ text: '📦 Entregado', callback_data: 'delivered' }],
                        ],
                    };

                    await sendMessage(chat_id, text, { reply_markup });

                    try {
                        await fetch(`${API}/deleteMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, message_id: msg.message_id, "disable_notification": true }) });
                    } catch (err) { console.log('No se pudo borrar mensaje original', err); }
                }
            }

            // --- Procesar callbacks ---
            if (body.callback_query) {
                const cb = body.callback_query;
                const chat_id = cb.message.chat.id;
                const message_id = cb.message.message_id;
                let lines = cb.message.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                const hasConfirmed = lines.some(l => /✅ Confirmado/.test(l));
                const hasDelivered = lines.some(l => /📦 Entregado/.test(l));
                const tgGetChat = (chat_id) =>
                    fetch(`${API}/getChat?chat_id=${encodeURIComponent(chat_id)}`, { method: 'GET' });
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
                            const tgPinChatMessage = (chat_id, message_id, opts = {}) =>
                                pinMessage(chat_id, message_id, opts);
                            // enviar en modo silencioso
                            const sent = await sendMessage(chat_id, summaryText, { parse_mode: 'Markdown', disable_notification: true });
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
                        await sendMessage(chat_id, pinnedExists ? 'true' : 'false', { disable_notification: true });

                    } catch (err) {
                        console.error('Error consultando getChat o creando/pineando summary:', err);
                        // fallback: escribir false silencioso
                        try { await sendMessage(chat_id, 'false', { disable_notification: true }); } catch (e) { console.error(e); }
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
