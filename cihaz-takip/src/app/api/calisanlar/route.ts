import { api, readJson } from "@/server/http";
import { createStaff } from "@/server/services/staff";

export const POST = api(async (ctx, req) => ({ staff: await createStaff(ctx, await readJson(req)) }));
