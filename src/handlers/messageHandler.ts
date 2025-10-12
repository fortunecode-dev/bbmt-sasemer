import { TelegramClient } from '../telegram';
import { normalizeUsername } from '../utils';

/**
 * Procesa mensajes que empiezan por "Remesa"
 * Formato esperado: "Remesa <sent> <given> <client name...>"
 */
export async function handleMessage(body: any, tg: TelegramClient) {
  const msg = body.message;
  if (!msg?.text) return null;
  const text = msg.text.trim();
  if (!text.startsWith('Remesa')) return null;

  const chat_id = msg.chat.id;
  const user_id = msg.from?.id;
  const username = normalizeUsername(msg.from);
  const mention = `[@${username}](tg://user?id=${user_id})`;

  const parts = text.split(/\s+/);
  if (parts.length < 3) {
    await tg.sendMessage(chat_id, 'Formato inválido. Uso: Remesa <sent> <given> <cliente>');
    return { handled: true };
  }

  const sent = parseFloat(parts[1]);
  const given = parseFloat(parts[2]);
  if (Number.isNaN(sent) || Number.isNaN(given)) {
    await tg.sendMessage(chat_id, 'Los montos deben ser números.');
    return { handled: true };
  }

  const clientName = parts.slice(3).join(' ') || 'Cliente';
  const gain = Math.abs(given - sent);
  const commission = +(gain * 0.2).toFixed(2);

  const replyText = [
    `**Confirma ${sent}**`,
    `**Cliente:** ${clientName}`,
    `**Remesa:** ${sent} ➡️ ${given}`,
    `**Ganancia:** $${gain}`,
    `**Comisión:** $${commission} (${mention})`,
    `**Fecha:** ${new Date().toLocaleDateString('en-GB')}`,
  ].join('\n');

  const reply_markup = {
    inline_keyboard: [
      [{ text: '✅ Confirmar', callback_data: 'confirm' }],
      [{ text: '📦 Entregado', callback_data: 'delivered' }],
    ],
  };

  await tg.sendMessage(chat_id, replyText, { reply_markup });

  // intento borrar el mensaje original, pero no fallo si no se puede
  try {
    await tg.deleteMessage(chat_id, msg.message_id);
  } catch (e) {
    // log en worker (no ruede todo)
    console.warn('no se pudo borrar mensaje original', e);
  }

  return { handled: true };
}
