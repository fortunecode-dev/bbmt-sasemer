import { updatePinnedSummary } from '../services/sumary';
import { TelegramClient } from '../telegram';
import { extractMoneyFromLine, extractUsernameFromLine, nowDateString } from '../utils';

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
  const hasRegistered = lines.some(line => line.includes('🗂️ Registrado'));

  // handler for noop (used when confirm button becomes inert)
  const doNothing = async () => {
    await tg.answerCallbackQuery(cb.id, 'Ya confirmado');
    return { handled: true };
  };

  // Route callback actions
  if (cb.data === 'confirm') {
    // If not confirmed yet, add Confirmed line (no undo)
    if (!hasConfirmed) {
      lines = lines.filter((l: string) => !/^Confirma\s+\d+/i.test(l));
      lines.push(`**✅ Confirmado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
    }

    // extract values to update summary
    const gainLine = lines.find((l: string) => /Ganancia/i.test(l)) || '';
    const commLine = lines.find((l: string) => /Comisión/i.test(l)) || '';
    const gainVal = extractMoneyFromLine(gainLine) || 0;
    const commVal = extractMoneyFromLine(commLine) || 0;
    const mention = extractUsernameFromLine(commLine) ||
      (cb.from?.username ? `@${cb.from.username}` : (cb.message?.from?.username ? `@${cb.message.from.username}` : '@unknown'));

    // update pinned summary (chat acts as DB)
    try {
      await updatePinnedSummary(tg, chat_id, mention, gainVal, commVal);
    } catch (error: any) {
      console.log('updatePinnedSummary', error);
    }

  } else if (cb.data === 'delivered') {
    if (!hasDelivered) lines.push(`**📦 Entregado:** ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
  } else if (cb.data === 'undo_delivered') {
    lines = lines.filter((l: string) => !/📦 Entregado/.test(l));
  } else if (cb.data === 'registered') {
    // mark as registrado (with timestamp and user who pressed)
    if (!hasRegistered) {
      const registrar = cb.from?.username ? `@${cb.from.username}` : (cb.from?.first_name || 'Usuario');
      lines.push(`**🗂️ Registrado:** ${registrar} ${new Date().toLocaleTimeString('en-GB')} ${new Date().toLocaleDateString('en-GB')}`);
    }
  } else if (cb.data === 'undo_registered') {
    lines = lines.filter((l: string) => !/🗂️ Registrado/.test(l));
  } else if (cb.data === 'undo_confirm') {
    // we purposely ignore undo_confirm because Confirmar no debe tener deshacer;
    // but if someone somehow calls it, remove confirm line (defensive)
    lines = lines.filter((l: string) => !/✅ Confirmado/.test(l));
  } else if (cb.data === 'noop' || cb.data === 'noop_confirm') {
    // inert callback when confirm button is shown as non-actionable
    return doNothing();
  }

  // recompute states and build keyboard
  const nowHasConfirmed = lines.some((l: string) => /✅ Confirmado/.test(l));
  const nowHasDelivered = lines.some((l: string) => /📦 Entregado/.test(l));
  const nowHasRegistered = lines.some((l: string) => /🗂️ Registrado/.test(l));

  // Build inline keyboard:
  // - Confirm button is shown but after confirming it becomes inert (no undo)
  // - Registered has undo
  // - Delivered has undo
  const inline_keyboard = [
    // Confirm: if not confirmed -> actionable, otherwise inert labeled "✅ Confirmado"
    nowHasConfirmed
      ? [{ text: '✅ Confirmado', callback_data: 'noop_confirm' }] // inert
      : [{ text: '✅ Confirmar', callback_data: 'confirm' }],

    // Registered toggle: show Deshacer if registered, else show Registrado
    nowHasRegistered
      ? [{ text: '⚠️ ❌ Deshacer Registrado', callback_data: 'undo_registered' }]
      : [{ text: '🗂️ Registrado', callback_data: 'registered' }],

    // Delivered toggle: show Deshacer if delivered, else show Entregado
    nowHasDelivered
      ? [{ text: '⚠️ ❌ Deshacer Entregado', callback_data: 'undo_delivered' }]
      : [{ text: '📦 Entregado', callback_data: 'delivered' }],
  ];

  const new_text = lines.join('\n');

  // Edit the message and answer the callback
  await tg.editMessageText(chat_id, message_id, new_text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard }, disable_notification: true });
  await tg.answerCallbackQuery(cb.id);
  return { handled: true };
}

