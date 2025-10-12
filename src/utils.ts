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
