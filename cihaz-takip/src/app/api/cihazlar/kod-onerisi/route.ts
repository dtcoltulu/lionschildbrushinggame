import { isUuid } from "@/lib/validate";
import { api } from "@/server/http";
import { suggestCode } from "@/server/services/devices";

/** Seçilen tür için sıradaki envanter kodu önerisi (ör. AER-004). */
export const GET = api(async (ctx, req) => {
  const typeId = req.nextUrl.searchParams.get("tur");
  return { code: isUuid(typeId) ? await suggestCode(ctx.db, typeId) : null };
});
