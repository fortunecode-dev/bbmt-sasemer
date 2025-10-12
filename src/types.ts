export interface Env {
  TELEGRAM_TOKEN: string;
  // agrega aquí otras variables de entorno si las necesitas
}

export type TgAPIResponse = {
  ok: boolean;
  result?: any;
  description?: string;
};
