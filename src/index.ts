import { Env } from './types';
import { safeJson, jsonResponse, textResponse } from './utils';
import { TelegramClient } from './telegram';
import { handleMessage } from './handlers/messageHandler';
import { handleCallback } from './handlers/callbackHandler';

export default {
  async fetch(request: Request, env: Env, ctx: any) {
    try {
      if (request.method === 'GET') return textResponse('Worker OK');

      if (request.method !== 'POST') return textResponse('Method Not Allowed', 405);

      const body = await (async () => {
        try { return await safeJson(request); }
        catch (err) {
          return { error: 'Invalid JSON' };
        }
      })();

      if (!body || body.error) return textResponse('Invalid JSON', 400);

      const token = env.TELEGRAM_TOKEN;
      if (!token) {
        console.error('TELEGRAM_TOKEN missing in env');
        return textResponse('Server misconfigured', 500);
      }

      const tg = new TelegramClient(token);

      // Handler chain: message -> callback -> default
      // Se intenta procesar mensajes y callbacks por separado
      try {
        if (body.message) {
          const res = await handleMessage(body, tg);
          if (res?.handled) return jsonResponse({ ok: true });
        }

        if (body.callback_query) {
          const res = await handleCallback(body, tg);
          if (res?.handled) return jsonResponse({ ok: true });
        }
      } catch (innerErr) {
        console.error('handler error', innerErr);
        // no abortamos: devolvemos ok para telegram pero registramos error
        return jsonResponse({ ok: false, error: 'handler_error' }, 500);
      }

      // Si no fue manejado por las rutas anteriores
      return jsonResponse({ ok: true, body });
    } catch (err) {
      console.error('unhandled error', err);
      return textResponse('Internal Error', 500);
    }
  },
};
