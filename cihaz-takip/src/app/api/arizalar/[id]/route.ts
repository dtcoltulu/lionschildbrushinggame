import { api, readJson } from "@/server/http";
import { purgeFault, updateFault } from "@/server/services/faults";

export const PATCH = api<{ id: string }>(async (ctx, req, { id }) => ({ fault: await updateFault(ctx, id, await readJson(req)) }));

/** Kalıcı silme (yalnızca yönetici, yalnızca önce silinmiş kayıt). */
export const DELETE = api<{ id: string }>(async (ctx, _req, { id }) => {
  await purgeFault(ctx, id);
});
