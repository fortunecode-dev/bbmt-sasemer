import { TelegramClient } from '../telegram';
import { escapeMarkdown, normalizeUsername, parseNumber } from '../utils';

/**
 * Procesa mensajes que empiezan por "Remesa"
 * Formato esperado: "Remesa <sent> <given> <client name...>"
 */
export async function handleMessage(body: any, tg: TelegramClient) {
  const msg = body.message;
  if (!msg?.text) return null;
  const text = msg.text.trim();
  if (!text.startsWith('Remesa')) return null;
  
  const rawText = (body.message.text || body.message.caption || '').trim();
  if (!/^\s*Remesa\s+/i.test(rawText)) return;

  const parts = rawText.split(/\s+/);
  if (parts.length < 3) return;

  const sent = parseNumber(parts[1]);
  const given = parseNumber(parts[2]);
  const clientName = parts.slice(3).join(' ') || 'Cliente';
  const gain = Math.abs(given - sent);
  const commission = +(gain * 0.2).toFixed(2);
  const username = body.message.from?.username || body.message.from?.first_name || String(body.message.from?.id || '');

  const message = `**Confirma ${escapeMarkdown(String(sent))}**
**Cliente:** ${escapeMarkdown(clientName)}
**Remesa:** ${escapeMarkdown(String(sent))} ➡️ ${escapeMarkdown(String(given))}
**Ganancia:** $${(gain-commission).toFixed(2)}
**Comisión:** $${commission.toFixed(2)} (@${escapeMarkdown(username)})
**Fecha:** ${escapeMarkdown(new Date(body.message.date * 1000).toLocaleDateString('en-GB'))}`;

  const reply_markup = {
    inline_keyboard: [
      [{ text: '✅ Confirmar', callback_data: 'confirm' }],
      [{ text: '📦 Entregado', callback_data: 'delivered' }]
    ]
  };

  await tg.sendMessage(body.message.chat.id, message, { reply_markup, parse_mode: 'Markdown', disable_notification: true });

  // try delete original (silently)
  try { await tg.deleteMessage(body.message.chat.id, body.message.message_id); } catch (e) { console.log('delete original failed', e); }
  return { handled: true };
}
