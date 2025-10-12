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
 * El resumen ahora contiene:
 *  - Header (mes)
 *  - Total Ganancia: $X
 *  - Total Comisión: $Y
 *  - (vacía)
 *  - @user1 — Ganancia: $G1 — Comisión: $C1 — Count: N1
 *  - ...
 *
 * @param tg TelegramService instance
 * @param chat_id Chat id
 * @param authorMention e.g. "@user"
 * @param gainVal number (ganancia de la remesa confirmada)
 * @param commVal number (comisión de la remesa confirmada)
 */
export async function updatePinnedSummary(
  tg: TelegramClient,
  chat_id: number | string,
  authorMention: string,
  gainVal: number,
  commVal: number
) {
  try {
    const chatResp = await tg.getChat(chat_id);
    const pinnedExists = !!(chatResp && (chatResp as any).result && (chatResp as any).result.pinned_message);

    // Helper: parse money numbers with comma or dot decimal
    const parseMoney = (s: string): number => {
      if (!s) return 0;
      const m = s.replace(/\s/g, '').match(/([0-9]+(?:[.,][0-9]+)?)/);
      if (!m) return 0;
      return parseFloat(m[1].replace(',', '.'));
    };

    // Helper: parse pinned text into header, totals and map per user
    const parsePinned = (text: string) => {
      const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
      let header = '';
      let totalGain = 0;
      let totalCommission = 0;
      const map: Record<string, { gain: number; commission: number; count: number }> = {};

      // If first line seems like a header (contains "Resumen" or emoji), take it
      if (lines.length && /Resumen|Resumen acumulado|Resumen acumulado/i.test(lines[0])) {
        header = lines.shift()!;
      } else if (lines.length && /^📌/.test(lines[0])) {
        header = lines.shift()!;
      }

      // If the next lines include totals, try to consume them
      if (lines.length && /Total\s+Ganancia/i.test(lines[0])) {
        totalGain = parseMoney(lines.shift()!);
      }
      if (lines.length && /Total\s+Comisión/i.test(lines[0])) {
        totalCommission = parseMoney(lines.shift()!);
      }

      // Skip a blank line if present
      if (lines.length && lines[0].length === 0) lines.shift();

      // Parse remaining user lines: @user — Ganancia: $X — Comisión: $Y — Count: N
      const userRe = /@?([A-Za-z0-9_]+)\s*—\s*Ganancia:\s*\$?([0-9.,]+)\s*—\s*Comisión:\s*\$?([0-9.,]+)\s*—\s*Count:\s*(\d+)/i;
      for (const pl of lines) {
        const m = pl.match(userRe);
        if (m) {
          const user = '@' + m[1];
          const g = parseFloat(m[2].replace(',', '.'));
          const c = parseFloat(m[3].replace(',', '.'));
          const cnt = parseInt(m[4], 10) || 0;
          map[user] = { gain: g, commission: c, count: cnt };
        }
      }

      return { header, totalGain, totalCommission, map };
    };

    // Helper: render full summary text from components
    const renderPinned = (header: string | null, totalGain: number, totalCommission: number, map: Record<string, { gain: number; commission: number; count: number }>) => {
      const nowHeader = header || `📌 Resumen acumulado (${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' })})`;
      const totalsLine1 = `Total Ganancia: $${totalGain.toFixed(2)}`;
      const totalsLine2 = `Total Comisión: $${totalCommission.toFixed(2)}`;
      const entries = Object.entries(map).sort((a, b) => b[1].gain - a[1].gain);
      const bodyLines = entries.map(([user, v]) => `${user} — Ganancia: $${v.gain.toFixed(2)} — Comisión: $${v.commission.toFixed(2)} — Count: ${v.count}`);
      const parts: string[] = [nowHeader, totalsLine1, totalsLine2, ''];
      if (bodyLines.length) parts.push(...bodyLines);
      else parts.push('_Sin entradas aún para este mes._');
      return parts.join('\n');
    };

    if (!pinnedExists) {
      // create initial summary: totals = current values, map with author
      const now = new Date();
      const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' });
      const header = `📌 Resumen acumulado (${monthYear})`;
      const totalGain = Number(gainVal || 0);
      const totalCommission = Number(commVal || 0);
      const map: Record<string, { gain: number; commission: number; count: number }> = {};
      map[authorMention] = { gain: totalGain, commission: totalCommission, count: 1 };

      const summaryText = renderPinned(header, totalGain, totalCommission, map);
      const sent = await tg.sendMessage(chat_id, summaryText, { parse_mode: 'Markdown', disable_notification: true });
      const pinnedMsgId = (sent as any)?.result?.message_id;
      if (pinnedMsgId) {
        try {
          await tg.pinChatMessage(chat_id, pinnedMsgId, { disable_notification: true });
        } catch (e) {
          console.error('pin failed', e);
        }
      }
      return;
    }

    // pinned exists: parse, update totals and per-user
    const pinned = (chatResp as any).result.pinned_message;
    const pinnedText = pinned?.text || '';
    const parsed = parsePinned(pinnedText);

    // update totals
    parsed.totalGain = Number(parsed.totalGain || 0) + Number(gainVal || 0);
    parsed.totalCommission = Number(parsed.totalCommission || 0) + Number(commVal || 0);

    // update user entry
    if (!parsed.map[authorMention]) parsed.map[authorMention] = { gain: 0, commission: 0, count: 0 };
    parsed.map[authorMention].gain += Number(gainVal || 0);
    parsed.map[authorMention].commission += Number(commVal || 0);
    parsed.map[authorMention].count += 1;

    const newPinnedText = renderPinned(parsed.header || null, parsed.totalGain, parsed.totalCommission, parsed.map);

    // try edit existing pinned (only succeeds if bot authored it)
    try {
      await tg.editMessageText(chat_id, pinned.message_id, newPinnedText, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Could not edit pinned (maybe not bot message):', err);
      // fallback: create a new summary message and pin it
      try {
        const sent = await tg.sendMessage(chat_id, newPinnedText, { parse_mode: 'Markdown', disable_notification: true });
        const newId = (sent as any)?.result?.message_id;
        if (newId) {
          try { await tg.pinChatMessage(chat_id, newId, { disable_notification: true }); } catch (e) { console.error('Pin fallback failed:', e); }
        }
      } catch (e) {
        console.error('Fallback create/pin failed:', e);
      }
    }
  } catch (err) {
    console.error('updatePinnedSummary error', err);
  }
}
