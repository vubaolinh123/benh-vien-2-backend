import type { Config } from '../config.js';
import { HttpError } from './http.js';

export async function verifyCaptcha(config: Config, token: string | undefined, ip: string | undefined) {
  if (!config.TURNSTILE_SECRET_KEY) return;
  if (!token) throw new HttpError(400, 'Vui lòng xác nhận bạn không phải robot.');
  const body = new URLSearchParams({ secret: config.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set('remoteip', ip);
  let result: { success: boolean; hostname?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    result = await response.json() as typeof result;
  } catch { throw new HttpError(503, 'Không thể kiểm tra xác thực lúc này. Vui lòng thử lại.'); }
  if (!result.success || result.hostname !== new URL(config.SITE_ORIGIN).hostname) throw new HttpError(400, 'Xác thực chưa hợp lệ. Vui lòng thử lại.');
}
