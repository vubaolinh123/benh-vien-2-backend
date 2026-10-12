import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(48),
  SITE_ORIGIN: z.url().default('https://benhviendaian.vn'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(0),
  UPLOAD_DIR: z.string().default('./uploads'),
  TURNSTILE_SECRET_KEY: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
export function readConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error(`Invalid API configuration: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  if (result.data.NODE_ENV === 'production' && !result.data.SITE_ORIGIN.startsWith('https://')) throw new Error('Production requires an HTTPS origin');
  return { ...result.data, UPLOAD_DIR: path.resolve(result.data.UPLOAD_DIR) };
}
