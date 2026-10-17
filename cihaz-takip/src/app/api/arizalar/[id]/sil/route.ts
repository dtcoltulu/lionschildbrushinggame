import { api, readJson } from "@/server/http";
import { deleteFault } from "@/server/services/faults";

/** Mantıksal silme (yönetici). */
export const POST = api<{ id: string }>(async (ctx, req, { id }) => {
  await deleteFault(ctx, id, await readJson(req));
});
