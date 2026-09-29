/**
 * Depo hatasını, gizli bilgi sızdırmadan kısa bir metne çevirir.
 * URL'ler ve uzun anahtar benzeri diziler maskelenir; uzunluk sınırlanır.
 */
export function describeStoreError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name !== "Error" ? `${err.name}: ` : ""}${err.message}` : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
  return (raw + cause)
    .replace(/https?:\/\/[^\s"')]+/gi, "<url>")
    .replace(/\b(sb_[a-z]+_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_.-]{20,})\b/g, "<anahtar>")
    .replace(/[A-Za-z0-9_-]{32,}/g, "<gizli>")
    .slice(0, 240);
}
