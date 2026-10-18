import { getDb } from "@/server/db";
import { api, readJson } from "@/server/http";
import { getLoginAdmin } from "@/server/login-admin";
import { createClinic } from "@/server/services/clinics";

export const POST = api(async (ctx, req) => ({ clinic: await createClinic(ctx, await getDb(), await readJson(req), getLoginAdmin()) }));
