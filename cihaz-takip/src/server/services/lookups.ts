import { normalizeKey } from "@/lib/normalize";
import { asBody, Reader } from "@/lib/validate";
import { audit, diff } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";

/** Yönetilebilir listeler: konumlar, cihaz türleri, arıza nedenleri, servis firmaları. */
export type LookupKind = "locations" | "device_types" | "fault_causes" | "service_vendors";
export const LOOKUP_KINDS: LookupKind[] = ["locations", "device_types", "fault_causes", "service_vendors"];

export interface LookupBase {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  version: number;
}
export type Location = LookupBase;
export interface DeviceType extends LookupBase {
  codePrefix: string;
  codeDigits: number;
  frequent: boolean;
}
export interface FaultCause extends LookupBase {
  systemKey: string | null;
}
export interface Vendor extends LookupBase {
  phone: string | null;
  note: string | null;
}

const META: Record<LookupKind, { entity: string; label: string; cols: string; nameMax: number }> = {
  locations: { entity: "location", label: "Konum", cols: "", nameMax: 80 },
  device_types: {
    entity: "device_type",
    label: "Cihaz türü",
    cols: `, code_prefix as "codePrefix", code_digits as "codeDigits", frequent`,
    nameMax: 80,
  },
  fault_causes: { entity: "fault_cause", label: "Arıza nedeni", cols: `, system_key as "systemKey"`, nameMax: 80 },
  service_vendors: { entity: "service_vendor", label: "Servis firması", cols: ", phone, note", nameMax: 120 },
};

export function isLookupKind(v: string): v is LookupKind {
  return (LOOKUP_KINDS as string[]).includes(v);
}

function selectSql(kind: LookupKind) {
  return `select id, name, sort_order as "sortOrder", active, version${META[kind].cols} from ${kind}`;
}

export async function listLookup<T extends LookupBase = LookupBase>(
  q: Queryable,
  kind: LookupKind,
  opts: { includeInactive?: boolean } = {},
): Promise<T[]> {
  const where = opts.includeInactive ? "" : "where active";
  return q.query<T>(`${selectSql(kind)} ${where} order by sort_order, name`);
}

export async function getLookup<T extends LookupBase = LookupBase>(q: Queryable, kind: LookupKind, id: string): Promise<T | null> {
  const rows = await q.query<T>(`${selectSql(kind)} where id = $1`, [id]);
  return rows[0] ?? null;
}

/** Cihaz türü kodu: Türkçe harfler sadeleştirilir, büyük harfe çevrilir ("aer" → "AER", "Işk" → "ISK"). */
export function normalizePrefix(v: string): string {
  return normalizeKey(v).replace(/ /g, "").toUpperCase();
}

interface Parsed {
  name: string;
  sortOrder: number;
  active: boolean;
  extra: Record<string, unknown>;
}

function parse(kind: LookupKind, body: Record<string, unknown>, existing: LookupBase | null): Parsed {
  const r = new Reader(body);
  const name = r.text("name", "Ad", { max: META[kind].nameMax });
  const sortOrder = r.int("sortOrder", "Sıra", 0, 9999, existing?.sortOrder ?? 100);
  const active = r.bool("active", existing?.active ?? true);
  const extra: Record<string, unknown> = {};
  if (kind === "device_types") {
    const raw = typeof body.codePrefix === "string" ? normalizePrefix(body.codePrefix) : "";
    if (!/^[A-Z]{2,5}$/.test(raw)) r.error("codePrefix", "Kod öneki 2–5 harf olmalı (örn. AER).");
    extra.code_prefix = raw;
    extra.code_digits = r.int("codeDigits", "Numara hane sayısı", 2, 4, (existing as DeviceType | null)?.codeDigits ?? 3);
    extra.frequent = r.bool("frequent", (existing as DeviceType | null)?.frequent ?? false);
  }
  if (kind === "service_vendors") {
    extra.phone = r.optText("phone", "Telefon", { max: 40 });
    extra.note = r.optText("note", "Not", { max: 500, multiline: true });
  }
  if (kind === "fault_causes" && existing && (existing as FaultCause).systemKey && !active) {
    r.error("active", `“${existing.name}” sistem seçeneğidir, pasifleştirilemez.`);
  }
  if (!r.ok) throw new ValidationError(r.errors);
  return { name, sortOrder, active, extra };
}

function uniqueError(kind: LookupKind, e: unknown): never {
  if (isUniqueViolation(e, "device_types_prefix_uq")) {
    throw new ConflictError("duplicate", "Bu kod öneki başka bir cihaz türünde kullanılıyor.", undefined, {
      codePrefix: "Bu kod öneki başka bir cihaz türünde kullanılıyor.",
    });
  }
  if (isUniqueViolation(e)) {
    const msg = `Bu adla bir ${META[kind].label.toLocaleLowerCase("tr")} zaten var (büyük/küçük harf ve Türkçe karakter farkı dikkate alınmaz).`;
    throw new ConflictError("duplicate", msg, undefined, { name: msg });
  }
  throw e;
}

export async function createLookup(ctx: Ctx, kind: LookupKind, input: unknown): Promise<LookupBase> {
  assertCan(ctx.actor, kind === "service_vendors" ? "vendor.create" : "lookups.manage");
  const p = parse(kind, asBody(input), null);
  const cols = ["name", "name_key", "sort_order", "active", ...Object.keys(p.extra)];
  const vals = [p.name, normalizeKey(p.name), p.sortOrder, p.active, ...Object.values(p.extra)];
  try {
    return await ctx.db.tx(async (q) => {
      const [row] = await q.query<{ id: string }>(
        `insert into ${kind} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        vals,
      );
      await audit(q, ctx, { entity: META[kind].entity, entityId: row!.id, action: "create", summary: `${META[kind].label} eklendi: ${p.name}` });
      return (await getLookup(q, kind, row!.id))!;
    });
  } catch (e) {
    uniqueError(kind, e);
  }
}

export async function updateLookup(ctx: Ctx, kind: LookupKind, id: string, input: unknown): Promise<LookupBase> {
  assertCan(ctx.actor, "lookups.manage");
  const body = asBody(input);
  const version = new Reader(body).version();
  try {
    return await ctx.db.tx(async (q) => {
      const existing = await getLookup(q, kind, id);
      if (!existing) throw new NotFoundError();
      const p = parse(kind, body, existing);
      const sets = ["name = $3", "name_key = $4", "sort_order = $5", "active = $6"];
      const vals: unknown[] = [id, version, p.name, normalizeKey(p.name), p.sortOrder, p.active];
      for (const [k, v] of Object.entries(p.extra)) {
        vals.push(v);
        sets.push(`${k} = $${vals.length}`);
      }
      const updated = await q.query(
        `update ${kind} set ${sets.join(", ")}, version = version + 1, updated_at = now() where id = $1 and version = $2 returning id`,
        vals,
      );
      if (updated.length === 0) throw new VersionConflictError({ current: existing });
      const after = (await getLookup(q, kind, id))!;
      const changes = diff(existing as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, {
        name: "Ad", sortOrder: "Sıra", active: "Aktif", codePrefix: "Kod öneki", codeDigits: "Hane", frequent: "Sık tamire giden", phone: "Telefon", note: "Not",
      });
      if (Object.keys(changes).length) {
        await audit(q, ctx, { entity: META[kind].entity, entityId: id, action: "update", summary: `${META[kind].label} güncellendi: ${after.name}`, changes });
      }
      return after;
    });
  } catch (e) {
    uniqueError(kind, e);
  }
}

export async function undeterminedCauseId(q: Queryable): Promise<string> {
  const rows = await q.query<{ id: string }>(`select id from fault_causes where system_key = 'belirlenmedi'`);
  if (!rows[0]) throw new Error("'Belirlenmedi' arıza nedeni bulunamadı (0002 geçişi uygulanmamış olabilir).");
  return rows[0].id;
}
