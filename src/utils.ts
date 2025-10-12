export const jsonResponse = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const textResponse = (text: string, status = 200) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });

export const safeJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    throw new Error('INVALID_JSON');
  }
};

export const nowDateString = (locale = 'en-GB') =>
  `${new Date().toLocaleTimeString(locale)} ${new Date().toLocaleDateString(locale)}`;

export const normalizeUsername = (from: any) =>
  from?.username || from?.first_name || 'Usuario';

export const escapeMarkdown = (s: string) =>
  (s ?? '').toString().replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

export const parseNumber = (token: string): number => {
  if (!token) return 0;
  const n = Number(token.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const extractMoneyFromLine = (line: string): number => {
  const m = line.match(/[\$]?([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return 0;
  return parseFloat(m[1].replace(',', '.'));
};

export const extractUsernameFromLine = (line: string): string | null => {
  const m = line.match(/\(@?([A-Za-z0-9_]+)\)/) || line.match(/@([A-Za-z0-9_]+)/);
  return m ? `@${m[1]}` : null;
};
