import { api, readJson } from "@/server/http";
import { getLoginAdmin } from "@/server/login-admin";
import { createUser } from "@/server/services/users";

export const POST = api(async (ctx, req) => createUser(ctx, await readJson(req), getLoginAdmin()));
