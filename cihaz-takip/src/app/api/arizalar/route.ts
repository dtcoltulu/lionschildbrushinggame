import { api, readJson } from "@/server/http";
import { createFault } from "@/server/services/faults";

export const POST = api(async (ctx, req) => ({ fault: await createFault(ctx, await readJson(req)) }));
