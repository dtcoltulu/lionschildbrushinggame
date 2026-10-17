import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_COOKIE } from "@/server/dev-session";
import { authMode } from "@/server/env";

export async function POST(req: NextRequest) {
  try {
    if (authMode() === "supabase") {
      const { supabaseForRequest } = await import("@/server/supabase");
      await (await supabaseForRequest()).auth.signOut();
    }
  } finally {
    (await cookies()).delete(DEV_COOKIE);
  }
  return NextResponse.redirect(new URL("/giris?cikis=1", req.url), 303);
}
