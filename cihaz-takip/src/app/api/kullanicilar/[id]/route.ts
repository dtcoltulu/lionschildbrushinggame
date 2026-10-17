import { api, readJson } from "@/server/http";
import { getLoginAdmin } from "@/server/login-admin";
import { updateUser } from "@/server/services/users";

export const PATCH = api<{ id: string }>(async (ctx, req, { id }) => ({ user: await updateUser(ctx, id, await readJson(req), getLoginAdmin()) }));
