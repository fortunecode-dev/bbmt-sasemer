// src/services/summary.ts

import { TelegramClient } from "../telegram";


type SummaryMap = Record<string, { gain: number; commission: number; count: number }>;

export function parsePinnedToMap(pinnedText: string): { header: string | null; map: SummaryMap } {
  const lines = (pinnedText || '').split('\n').map(l => l.trim()).filter(Boolean);
  let header: string | null = null;
  if (lines.length > 0 && /Resumen/i.test(lines[0])) {
    header = lines[0];
    lines.shift();
  }
  const map: SummaryMap = {};
  for (const pl of lines) {
    const m = pl.match(/@?([A-Za-z0-9_]+)\s*—\s*Ganancia:\s*\$?([0-9.,]+)\s*—\s*Comisión:\s*\$?([0-9.,]+)\s*—\s*Count:\s*(\d+)/i);
    if (m) {
      const user = '@' + m[1];
      const g = parseFloat(m[2].replace(',', '.'));
      const c = parseFloat(m[3].replace(',', '.'));
      const cnt = parseInt(m[4], 10) || 0;
      map[user] = { gain: g, commission: c, count: cnt };
    }
  }
  return { header, map };
}

export function renderSummary(header: string | null, map: SummaryMap): string {
  const nowHeader = header || `📌 Resumen acumulado (${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' })})`;
  const entries = Object.entries(map).sort((a, b) => b[1].gain - a[1].gain);
  const bodyLines = entries.map(([user, v]) => `${user} — Ganancia: $${v.gain.toFixed(2)} — Comisión: $${v.commission.toFixed(2)} — Count: ${v.count}`);
  return `${nowHeader}\n\n${bodyLines.join('\n')}`;
}

/**
 * Actualiza el resumen anclado: si no existe crea uno y lo pinnea.
 * @param tg TelegramService instance
 * @param chat_id Chat id
 * @param authorMention e.g. "@user"
 * @param gainVal number
 * @param commVal number
 */
export async function updatePinnedSummary(tg: TelegramClient, chat_id: number | string, authorMention: string, gainVal: number, commVal: number) {
  try {
    const chatResp = await tg.getChat(chat_id);
    const pinnedExists = !!(chatResp && (chatResp as any).result && (chatResp as any).result.pinned_message);

    if (!pinnedExists) {
      const now = new Date();
      const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' });
      const header = `📌 Resumen acumulado (${monthYear})`;
      const line = `${authorMention} — Ganancia: $${gainVal.toFixed(2)} — Comisión: $${commVal.toFixed(2)} — Count: 1`;
      const sent = await tg.sendMessage(chat_id, `${header}\n\n${line}`, { parse_mode: 'Markdown', disable_notification: true });
      const pinnedMsgId = (sent as any)?.result?.message_id;
      if (pinnedMsgId) {
        try { await tg.pinChatMessage(chat_id, pinnedMsgId, { disable_notification: true }); } catch (e) { console.error('pin failed', e); }
      }
      return;
    }

    const pinned = (chatResp as any).result.pinned_message;
    const pinnedText = pinned?.text || '';
    const { header, map } = parsePinnedToMap(pinnedText);

    if (!map[authorMention]) map[authorMention] = { gain: 0, commission: 0, count: 0 };
    map[authorMention].gain += Number(gainVal || 0);
    map[authorMention].commission += Number(commVal || 0);
    map[authorMention].count += 1;

    const newPinnedText = renderSummary(header || null, map);

    // try edit
    try {
      await tg.editMessageText(chat_id, pinned.message_id, newPinnedText, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Could not edit pinned (maybe not bot message):', err);
      // fallback: create a new pinned summary
      const sent = await tg.sendMessage(chat_id, newPinnedText, { parse_mode: 'Markdown', disable_notification: true });
      const newId = (sent as any)?.result?.message_id;
      if (newId) {
        try { await tg.pinChatMessage(chat_id, newId, { disable_notification: true }); } catch (e) { console.error('Pin fallback failed:', e); }
      }
    }
  } catch (err) {
    console.error('updatePinnedSummary error', err);
  }
}
