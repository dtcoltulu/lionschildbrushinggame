import { api, readJson } from "@/server/http";
import { updateStaff } from "@/server/services/staff";

export const PATCH = api<{ id: string }>(async (ctx, req, { id }) => ({ staff: await updateStaff(ctx, id, await readJson(req)) }));
