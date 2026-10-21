import { CURRENCIES } from "@/lib/labels";
import { normalizeKey } from "@/lib/normalize";
import { asBody, Reader } from "@/lib/validate";
import { audit, diff } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  paymentTerms: string | null;
  dueDays: number | null;
  currency: string;
  notes: string | null;
  active: boolean;
  version: number;
}

const SELECT = `select id, name, contact_name as "contactName", phone, email, payment_terms as "paymentTerms", due_days as "dueDays",
  currency, notes, active, version from suppliers`;

export async function listSuppliers(ctx: Ctx, opts: { includeInactive?: boolean } = {}): Promise<Supplier[]> {
  assertCan(ctx.actor, "supplier.view");
  return ctx.db.query<Supplier>(`${SELECT} ${opts.includeInactive ? "" : "where active"} order by name`);
}

/** Seçim listesi (sipariş, teklif, fatura formları). */
export async function supplierOptions(q: Queryable): Promise<{ value: string; label: string; currency: string; dueDays: number | null }[]> {
  const rows = await q.query<{ id: string; name: string; currency: string; dueDays: number | null }>(
    `select id, name, currency, due_days as "dueDays" from suppliers where active order by name`,
  );
  return rows.map((r) => ({ value: r.id, label: r.name, currency: r.currency, dueDays: r.dueDays }));
}

export async function getSupplier(ctx: Ctx, id: string): Promise<Supplier | null> {
  assertCan(ctx.actor, "supplier.view");
  return (await ctx.db.query<Supplier>(`${SELECT} where id = $1`, [id]))[0] ?? null;
}

function read(r: Reader) {
  return {
    name: r.text("name", "Firma / depo adı", { min: 2, max: 160 }),
    contactName: r.optText("contactName", "İlgili kişi", { max: 120 }),
    phone: r.optText("phone", "Telefon", { max: 40 }),
    email: r.optEmail("email", "E-posta"),
    paymentTerms: r.optText("paymentTerms", "Ödeme koşulları", { max: 300 }),
    dueDays: r.raw("dueDays") === "" || r.raw("dueDays") == null ? null : r.int("dueDays", "Vade (gün)", 0, 365, 0),
    currency: r.oneOf("currency", "Para birimi", CURRENCIES.values, "TRY"),
    notes: r.optText("notes", "Notlar", { multiline: true, max: 2000 }),
    active: r.bool("active", true),
  };
}

export async function createSupplier(ctx: Ctx, input: unknown): Promise<Supplier> {
  assertCan(ctx.actor, "supplier.manage");
  const r = new Reader(asBody(input));
  const s = read(r);
  if (!r.ok) throw new ValidationError(r.errors);
  try {
    return await ctx.db.tx(async (q) => {
      const [row] = await q.query<{ id: string }>(
        `insert into suppliers (name, name_key, contact_name, phone, email, payment_terms, due_days, currency, notes, active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [s.name, normalizeKey(s.name), s.contactName, s.phone, s.email, s.paymentTerms, s.dueDays, s.currency, s.notes, s.active],
      );
      await audit(q, ctx, { entity: "supplier", entityId: row!.id, supplierId: row!.id, action: "create", summary: `Tedarikçi eklendi: ${s.name}` });
      return (await q.query<Supplier>(`${SELECT} where id = $1`, [row!.id]))[0]!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError({ name: "Bu adla bir tedarikçi zaten kayıtlı." });
    throw e;
  }
}

export async function updateSupplier(ctx: Ctx, id: string, input: unknown): Promise<Supplier> {
  assertCan(ctx.actor, "supplier.manage");
  const r = new Reader(asBody(input));
  const version = r.version();
  const s = read(r);
  if (!r.ok) throw new ValidationError(r.errors);
  try {
    return await ctx.db.tx(async (q) => {
      const [cur] = await q.query<Supplier>(`${SELECT} where id = $1`, [id]);
      if (!cur) throw new NotFoundError("Tedarikçi bulunamadı.");
      const rows = await q.query(
        `update suppliers set name = $3, name_key = $4, contact_name = $5, phone = $6, email = $7, payment_terms = $8, due_days = $9,
           currency = $10, notes = $11, active = $12, version = version + 1, updated_at = now() where id = $1 and version = $2 returning id`,
        [id, version, s.name, normalizeKey(s.name), s.contactName, s.phone, s.email, s.paymentTerms, s.dueDays, s.currency, s.notes, s.active],
      );
      if (!rows.length) throw new VersionConflictError({ current: cur });
      const after = (await q.query<Supplier>(`${SELECT} where id = $1`, [id]))[0]!;
      const changes = diff(cur, after, {
        name: "Ad", contactName: "İlgili kişi", phone: "Telefon", email: "E-posta", paymentTerms: "Ödeme koşulları", dueDays: "Vade (gün)",
        currency: "Para birimi", notes: "Notlar", active: "Aktif",
      });
      if (Object.keys(changes).length) await audit(q, ctx, { entity: "supplier", entityId: id, supplierId: id, action: "update", summary: `Tedarikçi güncellendi: ${after.name}`, changes });
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError({ name: "Bu adla bir tedarikçi zaten kayıtlı." });
    throw e;
  }
}
