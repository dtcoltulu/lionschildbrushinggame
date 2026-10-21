import { normalizeKey } from "@/lib/normalize";
import { asBody, Reader } from "@/lib/validate";
import { audit, diff } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";

/** Yönetilebilir listeler: oda/bölüm ve ürün kategorileri. Silinmez, pasif yapılır (geçmiş kayıtlar korunur). */
export type LookupKind = "locations" | "categories";
export const LOOKUP_KINDS: LookupKind[] = ["locations", "categories"];
export const LOOKUP_LABELS: Record<LookupKind, string> = { locations: "Oda / bölüm", categories: "Ürün kategorisi" };

export function isLookupKind(v: string): v is LookupKind {
  return (LOOKUP_KINDS as string[]).includes(v);
}

export interface Lookup {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  version: number;
}

export async function listLookup(q: Queryable, kind: LookupKind, opts: { includeInactive?: boolean } = {}): Promise<Lookup[]> {
  return q.query<Lookup>(
    `select id, name, sort_order as "sortOrder", active, version from ${kind} ${opts.includeInactive ? "" : "where active"} order by sort_order, name`,
  );
}

export async function createLookup(ctx: Ctx, kind: LookupKind, input: unknown): Promise<Lookup> {
  assertCan(ctx.actor, "lookups.manage");
  const r = new Reader(asBody(input));
  const name = r.text("name", "Ad", { max: 80 });
  const sortOrder = r.int("sortOrder", "Sıra", 0, 9999, 100);
  if (!r.ok) throw new ValidationError(r.errors);
  try {
    return await ctx.db.tx(async (q) => {
      const [row] = await q.query<Lookup>(
        `insert into ${kind} (name, name_key, sort_order) values ($1, $2, $3) returning id, name, sort_order as "sortOrder", active, version`,
        [name, normalizeKey(name), sortOrder],
      );
      await audit(q, ctx, { entity: kind, entityId: row!.id, action: "create", summary: `${LOOKUP_LABELS[kind]} eklendi: ${name}` });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError({ name: `Bu ad zaten kayıtlı (${LOOKUP_LABELS[kind]}).` });
    throw e;
  }
}

export async function updateLookup(ctx: Ctx, kind: LookupKind, id: string, input: unknown): Promise<Lookup> {
  assertCan(ctx.actor, "lookups.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const name = r.text("name", "Ad", { max: 80 });
  const sortOrder = r.int("sortOrder", "Sıra", 0, 9999, 100);
  const active = r.bool("active", true);
  if (!r.ok) throw new ValidationError(r.errors);
  try {
    return await ctx.db.tx(async (q) => {
      const [cur] = await q.query<Lookup>(`select id, name, sort_order as "sortOrder", active, version from ${kind} where id = $1`, [id]);
      if (!cur) throw new NotFoundError();
      const [row] = await q.query<Lookup>(
        `update ${kind} set name = $3, name_key = $4, sort_order = $5, active = $6, version = version + 1, updated_at = now()
         where id = $1 and version = $2 returning id, name, sort_order as "sortOrder", active, version`,
        [id, version, name, normalizeKey(name), sortOrder, active],
      );
      if (!row) throw new VersionConflictError({ current: cur });
      const changes = diff(cur, row, { name: "Ad", sortOrder: "Sıra", active: "Aktif" });
      if (Object.keys(changes).length) await audit(q, ctx, { entity: kind, entityId: id, action: "update", summary: `${LOOKUP_LABELS[kind]} güncellendi: ${name}`, changes });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError({ name: `Bu ad zaten kayıtlı (${LOOKUP_LABELS[kind]}).` });
    throw e;
  }
}
