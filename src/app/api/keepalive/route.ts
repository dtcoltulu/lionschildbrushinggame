import { NextResponse } from "next/server";
import { getStore } from "@/lib/get-store";
import { describeStoreError } from "@/lib/store-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Başarılı bir kontrolden sonra bu süre içinde gelen istekler depoya gitmez (adresi sürekli çağıranlar veritabanını yormasın). */
const MIN_GAP_MS = 60_000;
let lastOkAt = 0;

/**
 * Supabase ücretsiz planında proje 7 gün boyunca hiç istek almazsa duraklatılır. Vercel Cron (vercel.json) bu adresi günde bir
 * çağırarak veritabanına küçük bir okuma isteği atar; oyun kullanılmayan haftalarda da proje etkin kalır.
 * Adres herkese açıktır ve yalnızca `{ ok: true }` döner (veri sızdırmaz).
 */
export async function GET() {
  const now = Date.now();
  if (lastOkAt && now - lastOkAt < MIN_GAP_MS) return NextResponse.json({ ok: true }, { headers: NO_STORE });

  const store = getStore();
  if (!store) return NextResponse.json({ error: "store_unavailable" }, { status: 503, headers: NO_STORE });
  try {
    await store.ping();
  } catch (err) {
    // Ayrıntıyı (adres/anahtar içerebilir) yanıta koymuyoruz; yalnızca maskelenmiş kısa özet loglanır.
    console.error("keepalive failed:", describeStoreError(err));
    return NextResponse.json({ error: "store_error" }, { status: 503, headers: NO_STORE });
  }
  lastOkAt = now;
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
