import { getDb } from "@/server/db";
import { api, readJson } from "@/server/http";
import { getLoginAdmin } from "@/server/login-admin";
import { updateClinic } from "@/server/services/clinics";

export const PATCH = api<{ id: string }>(async (ctx, req, { id }) => ({ clinic: await updateClinic(ctx, await getDb(), id, await readJson(req), getLoginAdmin()) }));
