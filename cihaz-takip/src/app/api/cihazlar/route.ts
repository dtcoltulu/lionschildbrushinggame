import { api, readJson } from "@/server/http";
import { createDevices } from "@/server/services/devices";

export const POST = api(async (ctx, req) => createDevices(ctx, await readJson(req)));
