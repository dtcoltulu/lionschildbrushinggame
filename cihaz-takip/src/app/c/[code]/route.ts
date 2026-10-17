import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth";
import { getDb } from "@/server/db";
import { findDeviceByCode } from "@/server/services/devices";

/**
 * Kısa cihaz adresi: /c/AER-001 → cihaz kartı. İleride cihazlara yapıştırılacak QR etiketleri bu adresi
 * taşır; telefonun kendi kamerasıyla okutulunca doğrudan cihaz kartı (ve "Arıza bildir") açılır.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await getActor())) {
    return NextResponse.redirect(new URL(`/giris?next=${encodeURIComponent(`/c/${code}`)}`, req.url), 307);
  }
  const id = await findDeviceByCode(await getDb(), decodeURIComponent(code).slice(0, 40));
  return NextResponse.redirect(new URL(id ? `/cihazlar/${id}` : `/cihazlar?q=${encodeURIComponent(code)}`, req.url), 307);
}
