import { TelegramClient } from '../telegram';
import { nowDateString } from '../utils';

function extractLines(text?: string) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean);
}

export async function handleCallback(body: any, tg: TelegramClient) {
  const cb = body.callback_query;
  if (!cb) return null;

  const chat_id = cb.message.chat.id;
  const message_id = cb.message.message_id;
  let lines = extractLines(cb.message.text);

  const hasConfirmed = lines.some(line => line.includes('✅ Confirmado'));
  const hasDelivered = lines.some(line => line.includes('📦 Entregado'));

  switch (cb.data) {
    case 'confirm':
      if (!hasConfirmed) {
        lines = lines.filter(line => !/^Confirma\s+\d+/i.test(line));
        lines.push(`**✅ Confirmado:** ${nowDateString()}`);
      }
      // ejemplo extra: check pinned message
      try {
        const chatInfo = await tg.getChat(chat_id);
        const pinnedExists = !!(chatInfo && chatInfo.result && chatInfo.result.pinned_message);
        await tg.sendMessage(chat_id, pinnedExists ? 'true' : 'false');
      } catch (err) {
        console.error('getChat error', err);
        await tg.sendMessage(chat_id, 'false');
      }
      break;

    case 'delivered':
      if (!hasDelivered) {
        lines.push(`**📦 Entregado:** ${nowDateString()}`);
      }
      break;

    case 'undo_confirm':
      lines = lines.filter(line => !line.includes('✅ Confirmado'));
      break;

    case 'undo_delivered':
      lines = lines.filter(line => !line.includes('📦 Entregado'));
      break;

    default:
      // acciones desconocidas: responder al callback para que no quede "cargando"
      await tg.answerCallbackQuery(cb.id, 'Acción no reconocida');
      return { handled: true };
  }

  const nowHasConfirmed = lines.some(line => line.includes('✅ Confirmado'));
  const nowHasDelivered = lines.some(line => line.includes('📦 Entregado'));

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

  await tg.editMessageText(chat_id, message_id, new_text, { reply_markup });
  await tg.answerCallbackQuery(cb.id);

  return { handled: true };
}
