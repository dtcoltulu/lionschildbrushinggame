import { api, readJson } from "@/server/http";
import { getLoginAdmin } from "@/server/login-admin";
import { resetPassword } from "@/server/services/users";

export const POST = api<{ id: string }>(async (ctx, req, { id }) => {
  await resetPassword(ctx, id, await readJson(req), getLoginAdmin());
});
