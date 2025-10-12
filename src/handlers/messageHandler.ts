// src/handlers/message.ts
import { TelegramClient } from '../telegram';
import { parseNumber, escapeMarkdown } from '../utils';

export async function handleMessage(body: any, env: any) {
  const TELEGRAM_TOKEN = env.TELEGRAM_TOKEN;
  const tg = new TelegramClient(TELEGRAM_TOKEN);
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

  const text = `**Confirma ${escapeMarkdown(String(sent))}**
**Cliente:** ${escapeMarkdown(clientName)}
**Remesa:** ${escapeMarkdown(String(sent))} ➡️ ${escapeMarkdown(String(given))}
**Ganancia:** $${escapeMarkdown(gain.toFixed(2))}
**Comisión:** $${escapeMarkdown(commission.toFixed(2))} (@${escapeMarkdown(username)})
**Fecha:** ${escapeMarkdown(new Date(body.message.date * 1000).toLocaleDateString('en-GB'))}`;

  const reply_markup = {
    inline_keyboard: [
      [{ text: '✅ Confirmar', callback_data: 'confirm' }],
      [{ text: '📦 Entregado', callback_data: 'delivered' }]
    ]
  };

  await tg.sendMessage(body.message.chat.id, text, { reply_markup, parse_mode: 'Markdown', disable_notification: true });

  // try delete original (silently)
  try { await tg.deleteMessage(body.message.chat.id, body.message.message_id); } catch (e) { console.log('delete original failed', e); }
  return { handled: true };
}
