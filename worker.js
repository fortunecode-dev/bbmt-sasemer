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

                // Normalizar búsqueda de estados
                const hasConfirmed = lines.some(line => line.includes('✅ Confirmado'));
                const hasDelivered = lines.some(line => line.includes('📦 Entregado'));

                // Aplicar acción según callback
                switch (cb.data) {
                    case 'confirm':
                        // Si ya estaba confirmado, no duplicar
                        if (!hasConfirmed) {
                            // eliminar posible "Confirma X" si existe
                            lines = lines.filter(line => !/^Confirma\s+\d+/i.test(line));
                            lines.push(`**✅ Confirmado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
                        }
                        break;
                    case 'delivered':
                        if (!hasDelivered) {
                            lines.push(`**📦 Entregado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
                        }
                        break;
                    case 'undo_confirm':
                        // quitar solo la línea de confirmado
                        lines = lines.filter(line => !line.includes('✅ Confirmado'));
                        break;
                    case 'undo_delivered':
                        lines = lines.filter(line => !line.includes('📦 Entregado'));
                        break;
                }

                // recomputar estados después del cambio
                const nowHasConfirmed = lines.some(line => line.includes('✅ Confirmado'));
                const nowHasDelivered = lines.some(line => line.includes('📦 Entregado'));

                // construir teclado: si ahora está confirmado mostramos "Deshacer Confirmar", si no mostramos "Confirmar"
                const inline_keyboard = [
                    nowHasConfirmed
                        ? [{ text: '⚠️ ❌ Deshacer Confirmar', callback_data: 'undo_confirm' }]
                        : [{ text: '✅ Confirmar', callback_data: 'confirm' }],
                    nowHasDelivered
                        ? [{ text: '⚠️ ❌ Deshacer Entregado', callback_data: 'undo_delivered' }]
                        : [{ text: '📦 Entregado', callback_data: 'delivered' }],
                ];

                const new_text = lines.join('\n');
                const reply_markup = { inline_keyboard };

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

