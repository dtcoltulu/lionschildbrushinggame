import "server-only";

/**
 * Basit yavaşlatma: aynı hesaba art arda hatalı girişlerde bekletir (Supabase'in kendi hız sınırına ek).
 * Sunucu örneği başına tutulur; asıl koruma Supabase Auth'un hız sınırıdır.
 */
const fails = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const LIMIT = 8;

export function tooManyFailures(key: string): boolean {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  fails.set(key, list);
  return list.length >= LIMIT;
}

export function recordFailure(key: string): void {
  const list = fails.get(key) ?? [];
  list.push(Date.now());
  fails.set(key, list);
}
