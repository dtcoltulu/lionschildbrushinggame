import { api, readJson } from "@/server/http";
import { updateDevice } from "@/server/services/devices";

export const PATCH = api<{ id: string }>(async (ctx, req, { id }) => ({ device: await updateDevice(ctx, id, await readJson(req)) }));
