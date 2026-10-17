import { api, readJson } from "@/server/http";
import { dismissDeletionRequest, requestDeletion } from "@/server/services/faults";

/** Personel: yanlış kaydı yöneticiye bildirir. */
export const POST = api<{ id: string }>(async (ctx, req, { id }) => {
  await requestDeletion(ctx, id, await readJson(req));
});

/** Yönetici: talebi reddeder. */
export const DELETE = api<{ id: string }>(async (ctx, _req, { id }) => {
  await dismissDeletionRequest(ctx, id);
});
