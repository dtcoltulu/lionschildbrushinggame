import { api } from "@/server/http";
import { restoreFault } from "@/server/services/faults";

export const POST = api<{ id: string }>(async (ctx, _req, { id }) => {
  await restoreFault(ctx, id);
});
