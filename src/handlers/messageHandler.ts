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
  const key = text.split(" ")[0]
  const rawText = (body.message.text || body.message.caption || '').trim();
  switch (key) {
    case "Remesa":
      if (!/^\s*Remesa\s+/i.test(rawText)) return;

      const remesaParts = rawText.split(/\s+/);
      if (remesaParts.length < 3) return;

      const sent = parseNumber(remesaParts[1]);
      const given = parseNumber(remesaParts[2]);
      if (isNaN(sent) || isNaN(given) || sent == 0) return null
      const clientName = remesaParts.slice(3).join(' ') || 'Cliente';
      const gain = Math.abs(given - sent);
      const commission = +(gain * 0.2).toFixed(2);
      const username = body.message.from?.username || body.message.from?.first_name || String(body.message.from?.id || '');

      const remesa = `**Confirma ${escapeMarkdown(String(sent))}**
**Cliente:** ${escapeMarkdown(clientName)}
**Remesa:** ${escapeMarkdown(String(sent))} ➡️ ${escapeMarkdown(String(given))}
**Ganancia:** $${(gain - commission).toFixed(2)}
**Comisión:** $${commission.toFixed(2)} (@${escapeMarkdown(username)})
**Fecha:** ${escapeMarkdown(new Date(body.message.date * 1000).toLocaleDateString('en-GB'))}`;

      const reply_markup = {
        inline_keyboard: [
          [{ text: '✅ Confirmar', callback_data: 'confirm' }],
          [{ text: '📦 Entregado', callback_data: 'delivered' }]
        ]
      };

      await tg.sendMessage(body.message.chat.id, remesa, { reply_markup, parse_mode: 'Markdown', disable_notification: true });

      // try delete original (silently)
      try { await tg.deleteMessage(body.message.chat.id, body.message.message_id); } catch (e) { console.log('delete original failed', e); }
      return { handled: true };
    case "Ingreso":
      if (!/^\s*Remesa\s+/i.test(rawText)) return;

      const parts = rawText.split(/\s+/);
      if (remesaParts.length < 3) return;

      const income = parseNumber(remesaParts[1]);
      if (isNaN(income) || income == 0) return null
      const description = remesaParts.slice(2).join(' ') || 'Sin descripción';
      const responsable = body.message.from?.username || body.message.from?.first_name || String(body.message.from?.id || '');

      const log = `**Entrada $${escapeMarkdown(String(income))}**
**Descripción:** ${escapeMarkdown(description)}
**Declarado por:** ${escapeMarkdown(String(responsable))}
**Fecha:** ${escapeMarkdown(new Date(body.message.date * 1000).toLocaleDateString('en-GB'))}`;

      await tg.sendMessage(body.message.chat.id, log, { parse_mode: 'Markdown', disable_notification: true });

      // try delete original (silently)
      try { await tg.deleteMessage(body.message.chat.id, body.message.message_id); } catch (e) { console.log('delete original failed', e); }
      return { handled: true };
    default:
      return null;
  }

}
