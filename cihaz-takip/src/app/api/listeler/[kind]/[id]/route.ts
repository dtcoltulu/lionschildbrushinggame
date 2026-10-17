import { NotFoundError } from "@/server/errors";
import { api, readJson } from "@/server/http";
import { isLookupKind, updateLookup } from "@/server/services/lookups";

export const PATCH = api<{ kind: string; id: string }>(async (ctx, req, { kind, id }) => {
  if (!isLookupKind(kind)) throw new NotFoundError("Bilinmeyen liste.");
  return { item: await updateLookup(ctx, kind, id, await readJson(req)) };
});
