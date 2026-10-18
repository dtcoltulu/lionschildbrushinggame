import { getDb } from "@/server/db";
import { api, readJson } from "@/server/http";
import { getLoginAdmin } from "@/server/login-admin";
import { setClinicPassword } from "@/server/services/clinics";

export const POST = api<{ id: string }>(async (ctx, req, { id }) => ({ clinic: await setClinicPassword(ctx, await getDb(), id, await readJson(req), getLoginAdmin()) }));
