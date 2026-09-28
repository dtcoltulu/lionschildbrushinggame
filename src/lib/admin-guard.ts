import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, verifySessionToken } from "./auth";

/** Sayfa düzeyinde ikinci koruma katmanı (proxy'ye ek olarak). */
export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(ADMIN_COOKIE)?.value);
}

export async function requireAdmin(next = "/admin"): Promise<void> {
  if (!(await isAdmin())) redirect(`/admin/login?next=${encodeURIComponent(next)}`);
}
