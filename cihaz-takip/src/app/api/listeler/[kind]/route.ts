import { NotFoundError } from "@/server/errors";
import { api, readJson } from "@/server/http";
import { createLookup, isLookupKind } from "@/server/services/lookups";

export const POST = api<{ kind: string }>(async (ctx, req, { kind }) => {
  if (!isLookupKind(kind)) throw new NotFoundError("Bilinmeyen liste.");
  return { item: await createLookup(ctx, kind, await readJson(req)) };
});
