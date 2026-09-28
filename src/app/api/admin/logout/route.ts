import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = new NextResponse(null, { status: 303, headers: { location: "/admin/login", "cache-control": "no-store" } });
  res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
