// Bounded aggregate cache; rejected promises are removed so an outage can recover.
let cached: { value: unknown; expiresAt: number } | null = null;
let pending: Promise<unknown> | null = null;
export function invalidatePublicCache() { cached = null; }
export async function cachedHome<T>(load: () => Promise<T>): Promise<T> {
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (!pending) pending = load().then(value => { cached = { value, expiresAt: Date.now() + 30000 }; return value; }).finally(() => { pending = null; });
  return pending as Promise<T>;
}
