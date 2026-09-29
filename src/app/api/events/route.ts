import { NextResponse } from "next/server";
import { MAX_BODY_BYTES, normalizeBatch, validateBatch } from "@/analytics/server/validate";
import { getStore } from "@/lib/get-store";
import { describeStoreError } from "@/lib/store-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const store = getStore();
  if (!store) return NextResponse.json({ error: "store_unavailable" }, { status: 503, headers: NO_STORE });

  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: "body" }, { status: 400, headers: NO_STORE });
  }
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413, headers: NO_STORE });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400, headers: NO_STORE });
  }

  const parsed = validateBatch(json);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });

  const now = Date.now();
  const events = normalizeBatch(parsed.value, now);
  if (events.length === 0) return NextResponse.json({ ok: true, stored: 0 }, { headers: NO_STORE });

  const firstSeenAt = events.map((e) => e.occurredAt).sort()[0]!;
  try {
    await store.insertBatch({
      sessionId: parsed.value.sessionId,
      campaignId: parsed.value.campaignId,
      deviceClass: parsed.value.deviceClass ?? null,
      firstSeenAt,
      events,
    });
  } catch (err) {
    // Ayrıntıyı (kimlik içerebilir) loglamıyoruz; istemci kuyrukta tutup tekrar dener.
    console.error("events insert failed:", describeStoreError(err));
    return NextResponse.json({ error: "store_error" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, stored: events.length }, { headers: NO_STORE });
}
