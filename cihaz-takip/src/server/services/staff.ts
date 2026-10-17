import { JOB_ROLE_VALUES, jobRoleLabel, type JobRole } from "@/lib/labels";
import { normalizeKey } from "@/lib/normalize";
import { asBody, Reader } from "@/lib/validate";
import { audit, diff } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";

export interface Staff {
  id: string;
  fullName: string;
  jobRole: JobRole;
  /** Bir çalışan birden fazla oda / üniteye bakabilir. */
  locationIds: string[];
  locationNames: string[];
  workEmail: string | null;
  note: string | null;
  active: boolean;
  version: number;
  hasLogin: boolean;
}

const SELECT = `select s.id, s.full_name as "fullName", s.job_role as "jobRole",
  coalesce((select array_agg(l.id::text order by l.sort_order, l.name) from staff_locations sl join locations l on l.id = sl.location_id where sl.staff_id = s.id), '{}') as "locationIds",
  coalesce((select array_agg(l.name order by l.sort_order, l.name) from staff_locations sl join locations l on l.id = sl.location_id where sl.staff_id = s.id), '{}') as "locationNames",
  s.work_email as "workEmail", s.note, s.active, s.version,
  exists (select 1 from app_users u where u.staff_id = s.id) as "hasLogin"
  from staff s`;

export async function listStaff(q: Queryable, opts: { includeInactive?: boolean } = {}): Promise<Staff[]> {
  return q.query<Staff>(`${SELECT} ${opts.includeInactive ? "" : "where s.active"} order by s.active desc, s.full_name`);
}

export async function getStaff(q: Queryable, id: string): Promise<Staff | null> {
  return (await q.query<Staff>(`${SELECT} where s.id = $1`, [id]))[0] ?? null;
}

interface StaffInput {
  fullName: string;
  jobRole: JobRole;
  locationIds: string[];
  workEmail: string | null;
  note: string | null;
  active: boolean;
}

function parse(body: Record<string, unknown>, existing: Staff | null): StaffInput {
  const r = new Reader(body);
  const out: StaffInput = {
    fullName: r.text("fullName", "Ad soyad", { min: 2, max: 120 }),
    jobRole: r.oneOf("jobRole", "Görev", JOB_ROLE_VALUES),
    locationIds: r.ids("locationIds", "İlgili odalar / üniteler"),
    workEmail: r.optEmail("workEmail", "İş e-postası"),
    note: r.optText("note", "Not", { multiline: true, max: 1000 }),
    active: r.bool("active", existing?.active ?? true),
  };
  if (!r.ok) throw new ValidationError(r.errors);
  return out;
}

/**
 * Aynı kişinin farklı yazımlarla (ör. "Ayşe Yılmaz" / "ayse yilmaz") tekrar oluşmasını önler.
 * Gerçekten farklı biriyse kullanıcı açıkça onaylayarak ekleyebilir (confirmDuplicate).
 */
async function assertNotDuplicate(q: Queryable, name: string, exceptId: string | null, confirmed: boolean) {
  if (confirmed) return;
  const same = await q.query<{ id: string; fullName: string; jobRole: string; active: boolean }>(
    `select id, full_name as "fullName", job_role as "jobRole", active from staff where name_key = $1 and ($2::uuid is null or id <> $2)`,
    [normalizeKey(name), exceptId],
  );
  if (same.length) {
    const s = same[0]!;
    const msg = `Bu isimde bir çalışan zaten kayıtlı: ${s.fullName} (${jobRoleLabel(s.jobRole)}${s.active ? "" : ", pasif"}). Aynı kişiyse yeni kart açmayın; farklı biriyse “Farklı bir kişi, yine de kaydet” seçeneğini işaretleyin.`;
    throw new ConflictError("duplicate_staff", msg, { existing: same }, { fullName: msg });
  }
}

async function assertLocations(q: Queryable, ids: string[]) {
  if (!ids.length) return;
  const found = await q.query<{ id: string }>(`select id from locations where id = any($1::uuid[])`, [ids]);
  if (found.length !== ids.length) throw new ValidationError({ locationIds: "Seçilen odalardan biri bulunamadı. Listeden tekrar seçin." });
}

async function writeLocations(q: Queryable, staffId: string, ids: string[]) {
  await q.query(`delete from staff_locations where staff_id = $1 and not (location_id = any($2::uuid[]))`, [staffId, ids]);
  for (const id of ids) {
    await q.query(`insert into staff_locations (staff_id, location_id) values ($1, $2) on conflict do nothing`, [staffId, id]);
  }
}

export async function createStaff(ctx: Ctx, input: unknown): Promise<Staff> {
  assertCan(ctx.actor, "staff.manage");
  const body = asBody(input);
  const p = parse(body, null);
  return ctx.db.tx(async (q) => {
    await assertNotDuplicate(q, p.fullName, null, body.confirmDuplicate === true);
    await assertLocations(q, p.locationIds);
    const [row] = await q.query<{ id: string }>(
      `insert into staff (full_name, name_key, job_role, work_email, note, active)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [p.fullName, normalizeKey(p.fullName), p.jobRole, p.workEmail, p.note, p.active],
    );
    await writeLocations(q, row!.id, p.locationIds);
    await audit(q, ctx, { entity: "staff", entityId: row!.id, action: "create", summary: `Personel eklendi: ${p.fullName} (${jobRoleLabel(p.jobRole)})` });
    return (await getStaff(q, row!.id))!;
  });
}

export async function updateStaff(ctx: Ctx, id: string, input: unknown): Promise<Staff> {
  assertCan(ctx.actor, "staff.manage");
  const body = asBody(input);
  const version = new Reader(body).version();
  return ctx.db.tx(async (q) => {
    const existing = await getStaff(q, id);
    if (!existing) throw new NotFoundError("Personel kartı bulunamadı.");
    const p = parse(body, existing);
    if (normalizeKey(p.fullName) !== normalizeKey(existing.fullName)) {
      await assertNotDuplicate(q, p.fullName, id, body.confirmDuplicate === true);
    }
    await assertLocations(q, p.locationIds);
    const rows = await q.query(
      `update staff set full_name = $3, name_key = $4, job_role = $5, work_email = $6, note = $7, active = $8,
         version = version + 1, updated_at = now()
       where id = $1 and version = $2 returning id`,
      [id, version, p.fullName, normalizeKey(p.fullName), p.jobRole, p.workEmail, p.note, p.active],
    );
    if (!rows.length) throw new VersionConflictError({ current: existing });
    await writeLocations(q, id, p.locationIds);
    const after = (await getStaff(q, id))!;
    const changes = diff(existing, after, {
      fullName: "Ad soyad", jobRole: "Görev", locationNames: "İlgili odalar / üniteler", workEmail: "İş e-postası", note: "Not", active: "Aktif",
    });
    if (Object.keys(changes).length) {
      const summary = changes.active
        ? `Personel ${after.active ? "aktif" : "pasif"} yapıldı: ${after.fullName}`
        : `Personel kartı güncellendi: ${after.fullName}`;
      await audit(q, ctx, { entity: "staff", entityId: id, action: "update", summary, changes });
    }
    return after;
  });
}

/** Bir personelin geçmiş kayıtları: pasif olsa da cihaz ve arıza ilişkileri korunur. */
export async function staffRecordCounts(q: Queryable, id: string) {
  const [r] = await q.query<{ responsibleDevices: number; noticed: number; lastUser: number; verifiedResponsible: number; otherUserDevices: number }>(
    `select
      (select count(*) from devices where responsible_staff_id = $1) as "responsibleDevices",
      (select count(*) from device_users where staff_id = $1) as "otherUserDevices",
      (select count(*) from faults where noticed_by_staff_id = $1 and deleted_at is null) as "noticed",
      (select count(*) from faults where last_user_staff_id = $1 and deleted_at is null) as "lastUser",
      (select count(*) from faults where responsible_staff_id = $1 and deleted_at is null) as "verifiedResponsible"`,
    [id],
  );
  return r!;
}
