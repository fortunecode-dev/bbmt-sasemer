import { TgAPIResponse } from './types';

export class TelegramClient {
  private apiBase: string;

  constructor(private token: string) {
    if (!token) throw new Error('TELEGRAM_TOKEN_NOT_PROVIDED');
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  private async post(endpoint: string, body: any): Promise<TgAPIResponse> {
    const res = await fetch(`${this.apiBase}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async sendMessage(chat_id: number | string, text: string, options: Record<string, any> = {}) {
    return this.post('sendMessage', { chat_id, text, parse_mode: 'Markdown', ...options });
  }

  async editMessageText(chat_id: number | string, message_id: number, text: string, options: Record<string, any> = {}) {
    return this.post('editMessageText', { chat_id, message_id, text, parse_mode: 'Markdown', disable_notification: true, ...options });
  }

  async answerCallbackQuery(callback_query_id: string, text = '') {
    return this.post('answerCallbackQuery', { callback_query_id, text, disable_notification: true });
  }

  async deleteMessage(chat_id: number | string, message_id: number) {
    return this.post('deleteMessage', { chat_id, message_id, disable_notification: true });
  }

  async getChat(chat_id: number | string) {
    const res = await fetch(`${this.apiBase}/getChat?chat_id=${encodeURIComponent(String(chat_id))}`);
    return res.json();
  }
  async pinChatMessage(chat_id: number | string, message_id: number, opts: Record<string, any> = {}) {
    return (await this.post('pinChatMessage', { chat_id, message_id, ...opts }));
  }
}
