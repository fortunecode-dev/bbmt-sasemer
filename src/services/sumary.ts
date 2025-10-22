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
// util: parse money tolerant to commas/dots
const parseMoney = (s: string): number => {
  if (!s) return 0;
  const m = s.replace(/\s/g, '').match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return 0;
  return parseFloat(m[1].replace(',', '.'));
};

// util: parse pinned summary into headerMonth, totals and per-user map
const parsePinned = (text: string) => {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  let headerLine = '';
  let totalGain = 0;
  let totalCommission = 0;
  let totalCount = 0;
  let visa = 0;
  const map: Record<string, { gain: number; commission: number; count: number }> = {};

  // detect header if first line contains "Informe" or month name
  if (lines.length && /Informe\s+/i.test(lines[0])) {
    headerLine = lines.shift()!;
  } else if (lines.length && /Resumen/i.test(lines[0])) {
    headerLine = lines.shift()!;
  }

  // next three lines expected: Ganancias:, Comisiones:, Cantidad de Remesas:
  if (lines.length && /Ganancias\s*:/i.test(lines[0])) {
    totalGain = parseMoney(lines.shift()!);
  }
  if (lines.length && /Comisiones\s*:/i.test(lines[0])) {
    totalCommission = parseMoney(lines.shift()!);
  }
  if (lines.length && /Cantidad\s+de\s+Remesas\s*:/i.test(lines[0])) {
    const m = (lines.shift() || '').match(/(\d+)/);
    totalCount = m ? parseInt(m[1], 10) : 0;
  }
  if (lines.length && /Disponible\s+en\s+Visa\s*:/i.test(lines[0])) {
    visa = parseMoney(lines.shift()!);
  }
  // skip blank
  if (lines.length && lines[0].length === 0) lines.shift();

  // skip possible "Gestores (...)" header
  if (lines.length && /Gestores/i.test(lines[0])) lines.shift();

  // parse remaining per-user lines of form: @user  - $G - $C - N
  const userRe = /@?([A-Za-z0-9_]+)\s*[-–]\s*\$?([0-9.,]+)\s*[-–]\s*\$?([0-9.,]+)\s*[-–]\s*(\d+)/i;
  for (const pl of lines) {
    const m = pl.match(userRe);
    if (m) {
      const user = '@' + m[1];
      const g = parseFloat(m[2].replace(',', '.'));
      const c = parseFloat(m[3].replace(',', '.'));
      const cnt = parseInt(m[4], 10) || 0;
      const v = parseInt(m[5], 10) || 0;
      map[user] = { gain: g, commission: c, count: cnt, };
      totalGain += 0; // totals will be recomputed below to avoid double counting
    }
  }

  // If map empty but lines had entries in slightly different format,
  // try loose parse: look for @username and numbers
  if (Object.keys(map).length === 0 && lines.length > 0) {
    for (const pl of lines) {
      const userMatch = pl.match(/@([A-Za-z0-9_]+)/);
      if (!userMatch) continue;
      const user = '@' + userMatch[1];
      const nums = pl.match(/([0-9]+(?:[.,][0-9]+)?)/g) || [];
      const g = nums[0] ? parseFloat(nums[0].replace(',', '.')) : 0;
      const c = nums[1] ? parseFloat(nums[1].replace(',', '.')) : 0;
      const cnt = nums[2] ? parseInt(nums[2], 10) : 0;
      const v = nums[3] ? parseInt(nums[3], 10) : 0;
      map[user] = { gain: g, commission: c, count: cnt, };
    }
  }

  // recompute totals from map if possible
  if (Object.keys(map).length > 0) {
    totalGain = 0;
    totalCommission = 0;
    totalCount = 0;
    for (const v of Object.values(map)) {
      totalGain += v.gain;
      totalCommission += v.commission;
      totalCount += v.count;
    }
  }

  return { headerLine, totalGain, totalCommission, totalCount, map, visa };
};

// util: render final pinned text in requested format
const renderPinned = (
  monthYearHeader: string | null,
  totalGain: number,
  totalCommission: number,
  totalCount: number,
  map: Record<string, { gain: number; commission: number; count: number }>,
  visaAvailable: number
) => {
  const header = monthYearHeader || `Informe ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Los_Angeles' })}`;
  const lines: string[] = [];
  lines.push(`${header}`);
  lines.push('');
  lines.push(`Ganancias: $${totalGain.toFixed(2)}`);
  lines.push(`Comisiones: $${totalCommission.toFixed(2)}`);
  lines.push(`Cantidad de Remesas: ${totalCount}`);
  lines.push(`Disponible en Visa: $${visaAvailable.toFixed(2)}`)

  lines.push('');
  lines.push('Gestores (Usuario/Ingresos/Comision/Cantidad):');
  // sort by gain desc
  const entries = Object.entries(map).sort((a, b) => b[1].gain - a[1].gain);
  if (entries.length === 0) {
    lines.push('_Sin gestores aún._');
  } else {
    for (const [user, v] of entries) {
      lines.push(`${user}  - $${v.gain.toFixed(2)} - $${v.commission.toFixed(2)} - ${v.count}`);
    }
  }
  return lines.join('\n');
};

/**
 * Actualiza el resumen anclado en el chat en el formato solicitado:
 *
 * Informe <Mes Año>
 * Ganancias: $XX
 * Comisiones: $YY
 * Cantidad de Remesas: N
 *
 * Gestores (Usuario/Ingresos/Comision/Cantidad):
 * @user1  - $G1 - $C1 - N1
 * @user2  - $G2 - $C2 - N2
 */
export async function updatePinnedSummary(
  tg: TelegramClient,
  chat_id: number | string,
  authorMention: string,
  gainVal: number,
  commVal: number,
  income: number
) {
  try {
    const chatResp = await tg.getChat(chat_id);
    const pinnedExists = !!(chatResp && (chatResp as any).result && (chatResp as any).result.pinned_message);

    // current month-year string to compare/reset
    const now = new Date();
    const currentMonthYear = `${now.toLocaleString('en-US', { month: 'long', timeZone: 'America/Los_Angeles' })} ${now.getFullYear()}`;
    const headerLabel = `Informe ${currentMonthYear}`;

    if (!pinnedExists) {
      // create new pinned summary with current values
      const map: Record<string, { gain: number; commission: number; count: number }> = {};
      if(authorMention)
      map[authorMention] = { gain: Number(gainVal || 0), commission: Number(commVal || 0), count: 1 };
      const totalGain = Number(gainVal || 0);
      const totalCommission = Number(commVal || 0);
      const totalCount = 1;
      const text = renderPinned(headerLabel, totalGain, totalCommission, totalCount, map, income);
      const sent = await tg.sendMessage(chat_id, text, { parse_mode: 'Markdown', disable_notification: true });
      const pinnedMsgId = (sent as any)?.result?.message_id;
      if (pinnedMsgId) {
        try { await tg.pinChatMessage(chat_id, pinnedMsgId, { disable_notification: true }); } catch (e) { console.error('pin failed', e); }
      }
      return;
    }

    // pinned exists: parse and update
    const pinned = (chatResp as any).result.pinned_message;
    const pinnedText = pinned?.text || '';
    const parsed = parsePinned(pinnedText);

    // if header month differs from current month -> reset totals and map
    const pinnedHeader = parsed.headerLine || '';
    let headerMonthYear = '';
    const m = pinnedHeader.match(/Informe\s+(.+)/i);
    if (m) headerMonthYear = m[1].trim();

    if (!headerMonthYear || headerMonthYear !== currentMonthYear) {
      // reset: start new month report
      const map: Record<string, { gain: number; commission: number; count: number }> = {};
      if(authorMention)
      map[authorMention] = { gain: Number(gainVal || 0), commission: Number(commVal || 0), count: 1 };
      const text = renderPinned(headerLabel, Number(gainVal || 0), Number(commVal || 0), 1, map, parsed.visa);
      // create new pinned message and pin it
      const sent = await tg.sendMessage(chat_id, text, { parse_mode: 'Markdown', disable_notification: true });
      const newId = (sent as any)?.result?.message_id;
      if (newId) {
        try { await tg.pinChatMessage(chat_id, newId, { disable_notification: true }); } catch (e) { console.error('Pin fallback failed:', e); }
      }
      return;
    }

    // same month: update totals and per-user entry
    const totalGain = Number(parsed.totalGain || 0) + Number(gainVal || 0);
    const totalCommission = Number(parsed.totalCommission || 0) + Number(commVal || 0);
    const totalCount = Number(parsed.totalCount || 0) + 1;
    const visa = Number(parsed.visa || 0) + Number(income || 0);

    const map = parsed.map;
    if (!map[authorMention] && authorMention) map[authorMention] = { gain: 0, commission: 0, count: 0 };
    map[authorMention].gain += Number(gainVal || 0);
    map[authorMention].commission += Number(commVal || 0);
    map[authorMention].count += 1;

    const newPinnedText = renderPinned(parsed.headerLine || headerLabel, totalGain, totalCommission, totalCount, map, visa);

    // attempt to edit pinned message (only works if bot created it)
    try {
      await tg.editMessageText(chat_id, pinned.message_id, newPinnedText, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Could not edit pinned (maybe not bot message):', err);
      // fallback: create and pin a fresh summary
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
    console.error('updatePinnedSummary error:', err);
  }
}
