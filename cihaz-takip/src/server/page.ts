import "server-only";
import { todayIstanbul } from "@/lib/dates";
import { jobRoleLabel } from "@/lib/labels";
import { requirePageActor, requirePageAdmin, requirePageSuperAdmin } from "./auth";
import type { Ctx } from "./context";
import { forClinic, getDb, type Queryable } from "./db";
import { listLookup, type DeviceType, type FaultCause, type Vendor } from "./services/lookups";

/** Sayfa bağlamı: oturum yoksa giriş sayfasına yönlendirir. Veritabanı yalnızca kullanıcının kliniğini görür. */
export async function pageCtx(opts: { admin?: boolean; superAdmin?: boolean } = {}): Promise<Ctx> {
  const actor = opts.superAdmin ? await requirePageSuperAdmin() : opts.admin ? await requirePageAdmin() : await requirePageActor();
  return { actor, db: forClinic(await getDb(), actor.clinicId), today: todayIstanbul() };
}

export interface Opt {
  value: string;
  label: string;
  group?: string;
}

export interface FormLookups {
  staff: Opt[];
  locations: Opt[];
  types: (Opt & { prefix: string; frequent: boolean })[];
  causes: (Opt & { systemKey: string | null })[];
  vendors: Opt[];
}

/**
 * Formlardaki seçim listeleri. Pasif kayıtlar yeni seçimde görünmez; ancak kayıtta zaten seçiliyse
 * "(pasif)" etiketiyle gösterilir ki geçmiş bilgi kaybolmasın.
 */
export async function formLookups(q: Queryable, keep: (string | null | undefined)[] = []): Promise<FormLookups> {
  const keepSet = new Set(keep.filter(Boolean) as string[]);
  const staff = await q.query<{ id: string; fullName: string; jobRole: string; active: boolean }>(
    `select id, full_name as "fullName", job_role as "jobRole", active from staff order by full_name`,
  );
  const [locations, types, causes, vendors] = await Promise.all([
    listLookup(q, "locations", { includeInactive: true }),
    listLookup<DeviceType>(q, "device_types", { includeInactive: true }),
    listLookup<FaultCause>(q, "fault_causes", { includeInactive: true }),
    listLookup<Vendor>(q, "service_vendors", { includeInactive: true }),
  ]);
  const visible = <T extends { id: string; active: boolean }>(r: T) => r.active || keepSet.has(r.id);
  const pas = (active: boolean) => (active ? "" : " (pasif)");
  return {
    staff: staff.filter(visible).map((s) => ({ value: s.id, label: `${s.fullName}${pas(s.active)}`, group: jobRoleLabel(s.jobRole) })),
    locations: locations.filter(visible).map((l) => ({ value: l.id, label: `${l.name}${pas(l.active)}` })),
    types: types.filter(visible).map((t) => ({
      value: t.id, label: `${t.name}${pas(t.active)}`, prefix: t.codePrefix, frequent: t.frequent,
      group: t.frequent ? "Sık kullanılan / sık tamire giden" : "Diğer cihazlar",
    })),
    causes: causes.filter(visible).map((c) => ({ value: c.id, label: `${c.name}${pas(c.active)}`, systemKey: c.systemKey })),
    vendors: vendors.filter(visible).map((v) => ({ value: v.id, label: `${v.name}${pas(v.active)}` })),
  };
}

export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function dateParam(v: string | string[] | undefined): string | null {
  const s = firstParam(v);
  return s && ISO.test(s) ? s : null;
}
