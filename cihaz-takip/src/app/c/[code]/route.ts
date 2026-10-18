import { NextResponse, type NextRequest } from "next/server";
import { getAuthState } from "@/server/auth";
import { forClinic, getDb } from "@/server/db";
import { findDeviceByCode } from "@/server/services/devices";

/**
 * Kısa cihaz adresi: /c/AER-001 → cihaz kartı. İleride cihazlara yapıştırılacak QR etiketleri bu adresi
 * taşır; telefonun kendi kamerasıyla okutulunca doğrudan cihaz kartı (ve "Arıza bildir") açılır.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const state = await getAuthState();
  if (state.kind !== "ok") {
    const page = state.kind === "choose_clinic" ? "/klinik-sec" : "/giris";
    return NextResponse.redirect(new URL(`${page}?next=${encodeURIComponent(`/c/${code}`)}`, req.url), 307);
  }
  // Envanter kodu klinik içinde benzersizdir: kod, kullanıcının kliniğinde aranır.
  const id = await findDeviceByCode(forClinic(await getDb(), state.actor.clinicId), decodeURIComponent(code).slice(0, 40));
  return NextResponse.redirect(new URL(id ? `/cihazlar/${id}` : `/cihazlar?q=${encodeURIComponent(code)}`, req.url), 307);
}
