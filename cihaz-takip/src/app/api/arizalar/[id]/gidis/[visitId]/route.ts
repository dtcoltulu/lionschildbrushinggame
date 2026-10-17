import { api, readJson } from "@/server/http";
import { updateVisit } from "@/server/services/faults";

export const PATCH = api<{ id: string; visitId: string }>(async (ctx, req, { id, visitId }) => ({
  fault: await updateVisit(ctx, id, visitId, await readJson(req)),
}));
