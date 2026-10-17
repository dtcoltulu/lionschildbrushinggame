import { dateParam } from "@/server/page";
import { api } from "@/server/http";
import { exportCsv } from "@/server/services/export";

/** Excel'de açılabilen CSV (UTF-8 BOM, noktalı virgül). Yalnızca yönetici. */
export const GET = api<{ kind: string }>(async (ctx, req, { kind }) => {
  const sp = req.nextUrl.searchParams;
  const { filename, body } = await exportCsv(ctx, kind, { from: dateParam(sp.get("from") ?? undefined), to: dateParam(sp.get("to") ?? undefined) });
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
