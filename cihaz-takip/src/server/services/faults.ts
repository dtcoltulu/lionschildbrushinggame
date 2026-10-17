import { faultDisplay, type FaultDisplay } from "@/lib/domain";
import { formatDate } from "@/lib/dates";
import {
  FAULT_STATUS_VALUES, faultStatusLabel, OUTCOME_VALUES, outcomeLabel, VERIFICATION_VALUES, verificationLabel,
  type FaultStatus, type Outcome, type Verification,
} from "@/lib/labels";
import { matchesQuery } from "@/lib/normalize";
import { asBody, Reader, type FieldErrors } from "@/lib/validate";
import { audit, auditForEntity, type AuditRow, type Changes } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan } from "../permissions";
import { undeterminedCauseId } from "./lookups";

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export interface Visit {
  id: string;
  faultId: string;
  vendorId: string | null;
  vendorName: string | null;
  sentOn: string | null;
  expectedReturnOn: string | null;
  serviceNote: string | null;
  returned: boolean;
  returnedOn: string | null;
  workDone: string | null;
  costAmount: number | null;
  costDate: string | null;
  receiptRef: string | null;
  outcome: Outcome | null;
  createdAt: string;
}

export interface FaultDetail {
  id: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  deviceBrand: string | null;
  deviceModel: string | null;
  description: string;
  noticedOn: string;
  noticedByStaffId: string | null;
  noticedByName: string | null;
  lastUserStaffId: string | null;
  lastUserName: string | null;
  locationId: string | null;
  locationName: string | null;
  causeId: string;
  causeName: string;
  causeSystemKey: string | null;
  causeDetail: string | null;
  causeVerification: Verification;
  responsibleStaffId: string | null;
  responsibleName: string | null;
  responsibilityEvidence: string | null;
  responsibilityVerifiedByStaffId: string | null;
  responsibilityVerifiedByName: string | null;
  status: FaultStatus;
  resolutionNote: string | null;
  closedAt: string | null;
  deletionRequestedAt: string | null;
  deletionRequestedBy: string | null;
  deletionRequestReason: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  version: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  visits: Visit[];
  currentVisit: Visit | null;
}

const FAULT_SELECT = `
select f.id, f.device_id as "deviceId", d.inventory_code as "deviceCode", d.name as "deviceName", d.brand as "deviceBrand", d.model as "deviceModel",
  f.description, f.noticed_on as "noticedOn",
  f.noticed_by_staff_id as "noticedByStaffId", nb.full_name as "noticedByName",
  f.last_user_staff_id as "lastUserStaffId", lu.full_name as "lastUserName",
  f.location_id as "locationId", l.name as "locationName",
  f.cause_id as "causeId", c.name as "causeName", c.system_key as "causeSystemKey", f.cause_detail as "causeDetail",
  f.cause_verification as "causeVerification",
  f.responsible_staff_id as "responsibleStaffId", rs.full_name as "responsibleName",
  f.responsibility_evidence as "responsibilityEvidence",
  f.responsibility_verified_by_staff_id as "responsibilityVerifiedByStaffId", rv.full_name as "responsibilityVerifiedByName",
  f.status, f.resolution_note as "resolutionNote", f.closed_at as "closedAt",
  f.deletion_requested_at as "deletionRequestedAt", dru.display_name as "deletionRequestedBy", f.deletion_request_reason as "deletionRequestReason",
  f.deleted_at as "deletedAt", du.display_name as "deletedBy", f.delete_reason as "deleteReason",
  f.version, f.created_at as "createdAt", cu.display_name as "createdBy", f.updated_at as "updatedAt"
from faults f
join devices d on d.id = f.device_id
join fault_causes c on c.id = f.cause_id
left join staff nb on nb.id = f.noticed_by_staff_id
left join staff lu on lu.id = f.last_user_staff_id
left join staff rs on rs.id = f.responsible_staff_id
left join staff rv on rv.id = f.responsibility_verified_by_staff_id
left join locations l on l.id = f.location_id
left join app_users dru on dru.id = f.deletion_requested_by
left join app_users du on du.id = f.deleted_by
left join app_users cu on cu.id = f.created_by`;

const VISIT_SELECT = `
select v.id, v.fault_id as "faultId", v.vendor_id as "vendorId", sv.name as "vendorName", v.sent_on as "sentOn",
  v.expected_return_on as "expectedReturnOn", v.service_note as "serviceNote", v.returned, v.returned_on as "returnedOn",
  v.work_done as "workDone", v.cost_amount as "costAmount", v.cost_date as "costDate", v.receipt_ref as "receiptRef",
  v.outcome, v.created_at as "createdAt"
from service_visits v left join service_vendors sv on sv.id = v.vendor_id`;

export async function getFault(q: Queryable, id: string): Promise<FaultDetail | null> {
  const rows = await q.query<Omit<FaultDetail, "visits" | "currentVisit">>(`${FAULT_SELECT} where f.id = $1`, [id]);
  if (!rows[0]) return null;
  // İptal edilen (yanlışlıkla açılan) gidişler gösterilmez ve hiçbir yerde sayılmaz.
  const visits = await q.query<Visit>(`${VISIT_SELECT} where v.fault_id = $1 and v.canceled_at is null order by v.created_at`, [id]);
  return { ...rows[0], visits, currentVisit: visits[visits.length - 1] ?? null };
}

export async function faultHistory(q: Queryable, id: string): Promise<AuditRow[]> {
  return auditForEntity(q, "fault", id);
}

export async function openFaultIdForDevice(q: Queryable, deviceId: string): Promise<string | null> {
  const rows = await q.query<{ id: string }>(`select id from faults where device_id = $1 and closed_at is null and deleted_at is null`, [deviceId]);
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Form girdisi
// ---------------------------------------------------------------------------

interface VisitInput {
  vendorId: string | null;
  sentOn: string | null;
  expectedReturnOn: string | null;
  serviceNote: string | null;
  returnedOn: string | null;
  workDone: string | null;
  costAmount: number | null;
  costDate: string | null;
  receiptRef: string | null;
  outcome: Outcome | null;
}

interface FaultInput {
  description: string;
  noticedOn: string;
  noticedByStaffId: string | null;
  lastUserStaffId: string | null;
  locationId: string | null;
  causeId: string | null;
  causeDetail: string | null;
  causeVerification: Verification;
  responsibleStaffId: string | null;
  responsibilityEvidence: string | null;
  responsibilityVerifiedByStaffId: string | null;
  status: FaultStatus;
  resolutionNote: string | null;
  visit: VisitInput;
  /** "Tamirden geldi" iken "Serviste" seçildi: true = tekrar gönderildi (yeni gidiş), false = yanlışlıkla seçilmişti (geri al). */
  resend: boolean | null;
}

function parseVisit(r: Reader, today: string, existing: Visit | null): VisitInput {
  const v = r.nested("visit");
  const keep = <K extends keyof VisitInput>(field: K, read: () => VisitInput[K]): VisitInput[K] =>
    v.has(field) ? read() : ((existing?.[field as keyof Visit] as VisitInput[K]) ?? null);
  return {
    vendorId: keep("vendorId", () => v.optId("vendorId", "Servis firması")),
    sentOn: keep("sentOn", () => v.optDate("sentOn", "Gönderim tarihi", { notAfter: today })),
    // Beklenen dönüş ileri tarih olabilir.
    expectedReturnOn: keep("expectedReturnOn", () => v.optDate("expectedReturnOn", "Beklenen dönüş tarihi")),
    serviceNote: keep("serviceNote", () => v.optText("serviceNote", "Servis notu", { multiline: true, max: 2000 })),
    returnedOn: keep("returnedOn", () => v.optDate("returnedOn", "Gerçek dönüş tarihi", { notAfter: today })),
    workDone: keep("workDone", () => v.optText("workDone", "Yapılan işlem", { multiline: true, max: 2000 })),
    costAmount: keep("costAmount", () => v.optMoney("costAmount", "Tamir maliyeti")),
    costDate: keep("costDate", () => v.optDate("costDate", "Masraf tarihi", { notAfter: today })),
    receiptRef: keep("receiptRef", () => v.optText("receiptRef", "Servis raporu / fiş referansı", { max: 120 })),
    outcome: keep("outcome", () => v.optOneOf("outcome", "Sonuç", OUTCOME_VALUES)),
  };
}

/**
 * Güncellemede gövdede OLMAYAN alanlar mevcut değerini korur (yalnızca gönderilen alanlar değişir);
 * bir alanı boşaltmak için açıkça boş değer gönderilir.
 */
function parseFault(body: Record<string, unknown>, today: string, existing: FaultDetail | null): FaultInput {
  const r = new Reader(body);
  const keep = <T>(field: keyof FaultDetail & string, read: () => T, fallback: T): T =>
    !existing || r.has(field) ? read() : ((existing[field] as T) ?? fallback);
  const p: FaultInput = {
    description: keep("description", () => r.longText("description", "Arıza açıklaması (Ne oldu?)"), ""),
    noticedOn: r.has("noticedOn") ? r.date("noticedOn", "Arızanın fark edildiği tarih", { notAfter: today }) : (existing?.noticedOn ?? today),
    noticedByStaffId: keep("noticedByStaffId", () => r.optId("noticedByStaffId", "Arızayı fark eden çalışan"), null),
    lastUserStaffId: keep("lastUserStaffId", () => r.optId("lastUserStaffId", "Son bilinen kullanıcı"), null),
    locationId: keep("locationId", () => r.optId("locationId", "Arıza anındaki oda / ünit"), null),
    causeId: keep("causeId", () => r.optId("causeId", "Arıza nedeni"), null),
    causeDetail: keep("causeDetail", () => r.optText("causeDetail", "Neden açıklaması", { max: 500, multiline: true }), null),
    causeVerification: r.oneOf("causeVerification", "Neden doğrulama durumu", VERIFICATION_VALUES, existing?.causeVerification ?? "on_degerlendirme"),
    responsibleStaffId: keep("responsibleStaffId", () => r.optId("responsibleStaffId", "Arızaya neden olduğu doğrulanan kişi"), null),
    responsibilityEvidence: keep("responsibilityEvidence", () => r.optText("responsibilityEvidence", "Tespit / kanıt açıklaması", { multiline: true, max: 2000 }), null),
    responsibilityVerifiedByStaffId: keep("responsibilityVerifiedByStaffId", () => r.optId("responsibilityVerifiedByStaffId", "Doğrulayan kişi"), null),
    status: r.oneOf("status", "Durum", FAULT_STATUS_VALUES, existing?.status ?? "arizali"),
    resolutionNote: keep("resolutionNote", () => r.optText("resolutionNote", "Çözüm notu", { multiline: true, max: 2000 }), null),
    visit: parseVisit(r, today, existing?.currentVisit ?? null),
    resend: r.has("resend") && body.resend !== null ? r.bool("resend") : null,
  };
  // Sorumluluk ataması yapılacaksa kanıt ve doğrulayan kişi zorunludur.
  if (p.responsibleStaffId) {
    if (!p.responsibilityEvidence) r.error("responsibilityEvidence", "Sorumluluk ataması için tespit / kanıt açıklaması yazılmalıdır.");
    if (!p.responsibilityVerifiedByStaffId) r.error("responsibilityVerifiedByStaffId", "Sorumluluk ataması için doğrulayan kişi seçilmelidir.");
  } else if (p.responsibilityEvidence || p.responsibilityVerifiedByStaffId) {
    r.error("responsibleStaffId", "Tespit açıklaması veya doğrulayan kişi girildi; arızaya neden olduğu doğrulanan kişiyi de seçin ya da bu alanları boşaltın.");
  }
  if (!r.ok) throw new ValidationError(r.errors);
  return p;
}

/** Tarihler arası tutarlılık; hata hangi alanda olduğunu söyler. Kaydı yalnızca gerçekten çelişen tarihler engeller. */
function checkVisitDates(errors: FieldErrors, noticedOn: string, v: VisitInput, returned: boolean) {
  if (v.sentOn && v.sentOn < noticedOn) {
    errors["visit.sentOn"] = `Gönderim tarihi, arızanın fark edildiği tarihten (${formatDate(noticedOn)}) önce olamaz.`;
  }
  if (v.expectedReturnOn && v.sentOn && v.expectedReturnOn < v.sentOn) {
    errors["visit.expectedReturnOn"] = `Beklenen dönüş tarihi gönderim tarihinden (${formatDate(v.sentOn)}) önce olamaz.`;
  }
  if (returned && v.returnedOn) {
    if (v.sentOn && v.returnedOn < v.sentOn) {
      errors["visit.returnedOn"] = `Gerçek dönüş tarihi gönderim tarihinden (${formatDate(v.sentOn)}) önce olamaz.`;
    } else if (!v.sentOn && v.returnedOn < noticedOn) {
      errors["visit.returnedOn"] = `Gerçek dönüş tarihi, arızanın fark edildiği tarihten (${formatDate(noticedOn)}) önce olamaz.`;
    }
  }
  if (returned && !v.outcome) {
    errors["visit.outcome"] = "Sonucu seçin: cihaz kullanıma hazır mı, sorun devam ediyor mu?";
  }
}

async function assertFaultRefs(q: Queryable, p: FaultInput) {
  const errors: FieldErrors = {};
  const people: [keyof FaultInput, string][] = [
    ["noticedByStaffId", "Arızayı fark eden çalışan"],
    ["lastUserStaffId", "Son bilinen kullanıcı"],
    ["responsibleStaffId", "Arızaya neden olduğu doğrulanan kişi"],
    ["responsibilityVerifiedByStaffId", "Doğrulayan kişi"],
  ];
  const ids = people.map(([k]) => p[k] as string | null).filter(Boolean) as string[];
  const found = ids.length ? new Set((await q.query<{ id: string }>(`select id from staff where id = any($1::uuid[])`, [ids])).map((r) => r.id)) : new Set();
  for (const [k, label] of people) if (p[k] && !found.has(p[k] as string)) errors[k] = `${label} bulunamadı. Listeden tekrar seçin.`;
  if (p.locationId && !(await q.query(`select 1 from locations where id = $1`, [p.locationId])).length) errors.locationId = "Oda / ünit bulunamadı.";
  if (p.causeId && !(await q.query(`select 1 from fault_causes where id = $1`, [p.causeId])).length) errors.causeId = "Arıza nedeni bulunamadı.";
  if (p.visit.vendorId && !(await q.query(`select 1 from service_vendors where id = $1`, [p.visit.vendorId])).length) errors["visit.vendorId"] = "Servis firması bulunamadı.";
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

function openFaultConflict(faultId: string | null): ConflictError {
  return new ConflictError(
    "open_fault_exists",
    "Bu cihazda zaten açık bir arıza kaydı var. Yeni kayıt açmak yerine mevcut kaydı güncelleyin.",
    { faultId },
  );
}

async function insertVisit(q: Queryable, ctx: Ctx, faultId: string, v: VisitInput, returned: boolean): Promise<string> {
  const [row] = await q.query<{ id: string }>(
    `insert into service_visits (fault_id, vendor_id, sent_on, expected_return_on, service_note, returned, returned_on, work_done,
       cost_amount, cost_date, receipt_ref, outcome, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) returning id`,
    [faultId, v.vendorId, v.sentOn, v.expectedReturnOn, v.serviceNote, returned, returned ? v.returnedOn : null, v.workDone,
      v.costAmount, v.costDate, v.receiptRef, returned ? v.outcome : null, ctx.actor.userId],
  );
  return row!.id;
}

async function writeVisit(q: Queryable, ctx: Ctx, visitId: string, v: VisitInput, returned: boolean) {
  await q.query(
    `update service_visits set vendor_id = $2, sent_on = $3, expected_return_on = $4, service_note = $5, returned = $6, returned_on = $7,
       work_done = $8, cost_amount = $9, cost_date = $10, receipt_ref = $11, outcome = $12, updated_by = $13, updated_at = now()
     where id = $1`,
    [visitId, v.vendorId, v.sentOn, v.expectedReturnOn, v.serviceNote, returned, returned ? v.returnedOn : null, v.workDone,
      v.costAmount, v.costDate, v.receiptRef, returned ? v.outcome : null, ctx.actor.userId],
  );
}

/** Arıza açık mı? "Tamirden geldi" yalnızca sonuç "Kullanıma hazır" ise kapanır. */
function isClosed(status: FaultStatus, outcome: Outcome | null): boolean {
  return status === "cozuldu" || (status === "tamirden_geldi" && outcome === "kullanima_hazir");
}

// ---------------------------------------------------------------------------
// Arıza bildirimi
// ---------------------------------------------------------------------------

export async function createFault(ctx: Ctx, input: unknown): Promise<FaultDetail> {
  assertCan(ctx.actor, "fault.create");
  const body = asBody(input);
  const r = new Reader(body);
  const deviceId = r.id("deviceId", "Cihaz");
  if (!r.ok) throw new ValidationError(r.errors);
  const p = parseFault(body, ctx.today, null);
  if (p.responsibleStaffId) assertCan(ctx.actor, "fault.assignResponsibility");
  const returned = p.status === "tamirden_geldi";
  const errors: FieldErrors = {};
  if (p.status === "serviste" || returned) checkVisitDates(errors, p.noticedOn, p.visit, returned);
  if (Object.keys(errors).length) throw new ValidationError(errors);

  try {
    return await ctx.db.tx(async (q) => {
      const [device] = await q.query<{ code: string; name: string; lifecycle: string; locationId: string | null }>(
        `select inventory_code as code, name, lifecycle, location_id as "locationId" from devices where id = $1 for update`,
        [deviceId],
      );
      if (!device) throw new ValidationError({ deviceId: "Cihaz bulunamadı. Listeden tekrar seçin." });
      if (device.lifecycle === "envanterden_cikarildi") {
        throw new ValidationError({ deviceId: "Bu cihaz envanterden çıkarılmış; arıza kaydı açılamaz." });
      }
      const open = await openFaultIdForDevice(q, deviceId);
      if (open) throw openFaultConflict(open);
      await assertFaultRefs(q, p);
      const causeId = p.causeId ?? (await undeterminedCauseId(q));
      const closed = isClosed(p.status, p.visit.outcome);
      const [row] = await q.query<{ id: string }>(
        `insert into faults (device_id, description, noticed_on, noticed_by_staff_id, last_user_staff_id, location_id, cause_id, cause_detail,
           cause_verification, responsible_staff_id, responsibility_evidence, responsibility_verified_by_staff_id, status, resolution_note,
           closed_at, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, ${closed ? "now()" : "null"}, $15, $15) returning id`,
        [deviceId, p.description, p.noticedOn, p.noticedByStaffId, p.lastUserStaffId, p.locationId, causeId, p.causeDetail,
          p.causeVerification, p.responsibleStaffId, p.responsibilityEvidence, p.responsibilityVerifiedByStaffId, p.status,
          p.status === "cozuldu" ? p.resolutionNote : null, ctx.actor.userId],
      );
      const id = row!.id;
      if (p.status === "serviste" || returned) await insertVisit(q, ctx, id, p.visit, returned);
      const extra = p.status === "arizali" ? "" : ` (durum: ${faultStatusLabel(p.status)})`;
      await audit(q, ctx, {
        entity: "fault", entityId: id, deviceId, action: "create",
        summary: `Arıza bildirildi: ${device.code} – ${p.description.slice(0, 80)}${extra}`,
      });
      return (await getFault(q, id))!;
    });
  } catch (e) {
    if (isUniqueViolation(e, "faults_one_open_per_device")) {
      throw openFaultConflict(await openFaultIdForDevice(ctx.db, deviceId));
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Arıza ve servis güncelleme (tek form, tek "Kaydet")
// ---------------------------------------------------------------------------

export async function updateFault(ctx: Ctx, id: string, input: unknown): Promise<FaultDetail> {
  assertCan(ctx.actor, "fault.edit");
  const body = asBody(input);
  const version = new Reader(body).version();
  try {
    return await ctx.db.tx(async (q) => {
      const cur = await getFault(q, id);
      if (!cur || cur.deletedAt) throw new NotFoundError("Arıza kaydı bulunamadı (silinmiş olabilir).");
      if (cur.version !== version) throw new VersionConflictError({ current: cur });
      const p = parseFault(body, ctx.today, cur);
      const respChanged =
        p.responsibleStaffId !== cur.responsibleStaffId ||
        p.responsibilityEvidence !== cur.responsibilityEvidence ||
        p.responsibilityVerifiedByStaffId !== cur.responsibilityVerifiedByStaffId;
      if (respChanged) assertCan(ctx.actor, "fault.assignResponsibility");
      await assertFaultRefs(q, p);

      const V = cur.currentVisit;
      const from = cur.status;
      const to = p.status;
      const errors: FieldErrors = {};
      type Op = { kind: "none" } | { kind: "new"; returned: boolean } | { kind: "update"; returned: boolean } | { kind: "cancel" };
      let op: Op = { kind: "none" };
      let reopen = false;

      if (to === "arizali") {
        if (from === "serviste") op = { kind: "cancel" };
        else if (from === "tamirden_geldi") {
          errors.status = "Tamirden gelen cihaz “Arızalı”ya döndürülemez. Sorun sürüyorsa sonucu “Sorun devam ediyor” seçin ya da “Serviste” seçip tekrar servise gönderin.";
        } else if (from === "cozuldu") reopen = true;
      } else if (to === "serviste") {
        if (from === "serviste") op = { kind: "update", returned: false };
        else if (from === "tamirden_geldi") {
          if (p.resend === null) {
            errors.resend = "Cihaz tekrar servise mi gönderildi, yoksa “Tamirden geldi” yanlışlıkla mı seçilmişti? Birini işaretleyin.";
          } else op = p.resend ? { kind: "new", returned: false } : { kind: "update", returned: false };
        } else op = { kind: "new", returned: false };
      } else if (to === "tamirden_geldi") {
        if (from === "serviste" || from === "tamirden_geldi") op = { kind: "update", returned: true };
        else op = { kind: "new", returned: true };
      } else if (to === "cozuldu") {
        if (from === "serviste") errors.status = "Cihaz serviste görünüyor. Önce “Tamirden geldi” olarak kaydedin ya da servise gönderimi geri almak için “Arızalı”yı seçin.";
      }

      // Yeni gidişte önceki gidişin bilgileri taşınmaz.
      const visitInput: VisitInput = op.kind === "new" ? parseVisit(new Reader(body), ctx.today, null) : p.visit;
      if (op.kind === "new" || op.kind === "update") checkVisitDates(errors, p.noticedOn, visitInput, op.returned);
      if ((op.kind === "update" || op.kind === "cancel") && !V) errors.status = "Bu kayıtta güncellenecek servis gidişi bulunamadı.";
      if (Object.keys(errors).length) throw new ValidationError(errors);

      const outcomeAfter = op.kind === "new" || op.kind === "update" ? (op.returned ? visitInput.outcome : null) : (V?.outcome ?? null);
      const closed = isClosed(to, to === "tamirden_geldi" ? outcomeAfter : null);
      const causeId = p.causeId ?? (await undeterminedCauseId(q));

      const rows = await q.query(
        `update faults set description = $3, noticed_on = $4, noticed_by_staff_id = $5, last_user_staff_id = $6, location_id = $7,
           cause_id = $8, cause_detail = $9, cause_verification = $10, responsible_staff_id = $11, responsibility_evidence = $12,
           responsibility_verified_by_staff_id = $13, status = $14, resolution_note = $15,
           closed_at = ${closed ? "coalesce(closed_at, now())" : "null"},
           updated_by = $16, updated_at = now(), version = version + 1
         where id = $1 and version = $2 returning id`,
        [id, version, p.description, p.noticedOn, p.noticedByStaffId, p.lastUserStaffId, p.locationId, causeId, p.causeDetail,
          p.causeVerification, p.responsibleStaffId, p.responsibilityEvidence, p.responsibilityVerifiedByStaffId, to,
          to === "cozuldu" ? p.resolutionNote : null, ctx.actor.userId],
      );
      if (!rows.length) throw new VersionConflictError({ current: cur });

      if (op.kind === "new") await insertVisit(q, ctx, id, visitInput, op.returned);
      else if (op.kind === "update") await writeVisit(q, ctx, V!.id, visitInput, op.returned);
      else if (op.kind === "cancel") {
        await q.query(`update service_visits set canceled_at = now(), canceled_by = $2 where id = $1`, [V!.id, ctx.actor.userId]);
      }

      const after = (await getFault(q, id))!;
      const changes = faultChanges(cur, after);
      let summary = `Arıza kaydı güncellendi: ${cur.deviceCode}`;
      if (from !== to || op.kind === "new") {
        if (op.kind === "new" && from === "tamirden_geldi") summary = `${cur.deviceCode}: tekrar servise gönderildi (yeni gidiş)`;
        else if (op.kind === "cancel") summary = `${cur.deviceCode}: servise gönderim geri alındı (gidiş sayılmaz)`;
        else if (from === "tamirden_geldi" && to === "serviste") summary = `${cur.deviceCode}: “Tamirden geldi” geri alındı, cihaz serviste`;
        else summary = `${cur.deviceCode}: durum ${faultStatusLabel(from)} → ${faultStatusLabel(to)}`;
      }
      if (reopen) summary = `${cur.deviceCode}: arıza kaydı yeniden açıldı`;
      if (Object.keys(changes).length || from !== to || op.kind !== "none") {
        await audit(q, ctx, { entity: "fault", entityId: id, deviceId: cur.deviceId, action: from !== to ? "status" : "update", summary, changes });
      }
      return after;
    });
  } catch (e) {
    if (isUniqueViolation(e, "faults_one_open_per_device")) {
      throw new ConflictError("open_fault_exists", "Bu cihazda başka bir açık arıza kaydı var; bu kayıt yeniden açılamaz. Önce diğer kaydı kapatın.");
    }
    throw e;
  }
}

/**
 * Önceki (güncel olmayan) bir servis gidişini düzeltme: ör. ilk gidişin maliyeti sonradan girilir.
 * Aynı gidişi düzenlemek yeni tamire gidiş sayılmaz.
 */
export async function updateVisit(ctx: Ctx, faultId: string, visitId: string, input: unknown): Promise<FaultDetail> {
  assertCan(ctx.actor, "fault.edit");
  const body = asBody(input);
  const version = new Reader(body).version();
  return ctx.db.tx(async (q) => {
    const cur = await getFault(q, faultId);
    if (!cur || cur.deletedAt) throw new NotFoundError("Arıza kaydı bulunamadı.");
    if (cur.version !== version) throw new VersionConflictError({ current: cur });
    const V = cur.visits.find((v) => v.id === visitId);
    if (!V) throw new NotFoundError("Servis gidişi bulunamadı.");
    const r = new Reader(body);
    const v = parseVisit(r, ctx.today, V);
    if (!r.ok) throw new ValidationError(r.errors);
    const errors: FieldErrors = {};
    checkVisitDates(errors, cur.noticedOn, v, V.returned);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    await writeVisit(q, ctx, visitId, v, V.returned);
    const isCurrent = cur.currentVisit?.id === visitId;
    const closed = isCurrent ? isClosed(cur.status, V.returned ? v.outcome : null) : !!cur.closedAt;
    await q.query(
      `update faults set version = version + 1, updated_at = now(), updated_by = $2, closed_at = ${closed ? "coalesce(closed_at, now())" : "null"} where id = $1`,
      [faultId, ctx.actor.userId],
    );
    const after = (await getFault(q, faultId))!;
    const changes = faultChanges(cur, after);
    await audit(q, ctx, { entity: "fault", entityId: faultId, deviceId: cur.deviceId, action: "update", summary: `${cur.deviceCode}: servis gidişi bilgileri güncellendi`, changes });
    return after;
  });
}

function faultChanges(a: FaultDetail, b: FaultDetail): Changes {
  const out: Changes = {};
  const add = (k: string, label: string, x: unknown, y: unknown) => {
    const from = x ?? null;
    const to = y ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) out[k] = { label, from, to };
  };
  add("description", "Açıklama", a.description, b.description);
  add("noticedOn", "Fark edildiği tarih", a.noticedOn, b.noticedOn);
  add("noticedBy", "Fark eden", a.noticedByName, b.noticedByName);
  add("lastUser", "Son bilinen kullanıcı", a.lastUserName, b.lastUserName);
  add("location", "Arıza anındaki konum", a.locationName, b.locationName);
  add("cause", "Arıza nedeni", a.causeName, b.causeName);
  add("causeDetail", "Neden açıklaması", a.causeDetail, b.causeDetail);
  add("causeVerification", "Neden doğrulama", verificationLabel(a.causeVerification), verificationLabel(b.causeVerification));
  add("responsible", "Doğrulanmış sorumlu", a.responsibleName, b.responsibleName);
  add("responsibilityEvidence", "Tespit / kanıt", a.responsibilityEvidence, b.responsibilityEvidence);
  add("responsibilityVerifiedBy", "Doğrulayan", a.responsibilityVerifiedByName, b.responsibilityVerifiedByName);
  add("status", "Durum", faultStatusLabel(a.status), faultStatusLabel(b.status));
  add("resolutionNote", "Çözüm notu", a.resolutionNote, b.resolutionNote);
  const va = a.currentVisit?.id === b.currentVisit?.id ? a.currentVisit : null;
  const vb = b.currentVisit;
  if (vb) {
    add("vendor", "Servis firması", va?.vendorName, vb.vendorName);
    add("sentOn", "Gönderim tarihi", va?.sentOn, vb.sentOn);
    add("expectedReturnOn", "Beklenen dönüş", va?.expectedReturnOn, vb.expectedReturnOn);
    add("serviceNote", "Servis notu", va?.serviceNote, vb.serviceNote);
    add("returnedOn", "Gerçek dönüş", va?.returnedOn, vb.returnedOn);
    add("workDone", "Yapılan işlem", va?.workDone, vb.workDone);
    add("costAmount", "Tamir maliyeti (TL)", va?.costAmount, vb.costAmount);
    add("costDate", "Masraf tarihi", va?.costDate, vb.costDate);
    add("receiptRef", "Rapor / fiş", va?.receiptRef, vb.receiptRef);
    add("outcome", "Sonuç", va?.outcome ? outcomeLabel(va.outcome) : null, vb.outcome ? outcomeLabel(vb.outcome) : null);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Silme, silme talebi, geri alma
// ---------------------------------------------------------------------------

function reason(input: unknown, field: string, label: string, required: boolean): string | null {
  const r = new Reader(asBody(input));
  const v = required ? r.longText(field, label, 500) : r.optText(field, label, { multiline: true, max: 500 });
  if (!r.ok) throw new ValidationError(r.errors);
  return v;
}

/** Personel yanlış kaydı silemez; yöneticiye bildirir. */
export async function requestDeletion(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "fault.requestDelete");
  const why = reason(input, "reason", "Silme talebinin nedeni", true);
  await ctx.db.tx(async (q) => {
    const cur = await getFault(q, id);
    if (!cur || cur.deletedAt) throw new NotFoundError("Arıza kaydı bulunamadı.");
    await q.query(
      `update faults set deletion_requested_at = now(), deletion_requested_by = $2, deletion_request_reason = $3 where id = $1`,
      [id, ctx.actor.userId, why],
    );
    await audit(q, ctx, { entity: "fault", entityId: id, deviceId: cur.deviceId, action: "request_delete", summary: `${cur.deviceCode}: silinmesi istendi – ${why}` });
  });
}

export async function dismissDeletionRequest(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx.actor, "fault.delete");
  await ctx.db.tx(async (q) => {
    const cur = await getFault(q, id);
    if (!cur) throw new NotFoundError();
    await q.query(`update faults set deletion_requested_at = null, deletion_requested_by = null, deletion_request_reason = null where id = $1`, [id]);
    await audit(q, ctx, { entity: "fault", entityId: id, deviceId: cur.deviceId, action: "dismiss_delete", summary: `${cur.deviceCode}: silme talebi reddedildi` });
  });
}

/**
 * Mantıksal silme: kayıt durur ama hiçbir sayıma, maliyete ve analize girmez; cihaz kartı korunur,
 * açık arıza silinince cihaza yeni arıza açılabilir. Yönetici geri alabilir.
 */
export async function deleteFault(ctx: Ctx, id: string, input: unknown): Promise<void> {
  assertCan(ctx.actor, "fault.delete");
  const why = reason(input, "reason", "Silme nedeni", false);
  await ctx.db.tx(async (q) => {
    const cur = await getFault(q, id);
    if (!cur) throw new NotFoundError();
    if (cur.deletedAt) return;
    await q.query(`update faults set deleted_at = now(), deleted_by = $2, delete_reason = $3, version = version + 1 where id = $1`, [id, ctx.actor.userId, why]);
    await audit(q, ctx, {
      entity: "fault", entityId: id, deviceId: cur.deviceId, action: "delete",
      summary: `${cur.deviceCode}: arıza kaydı silindi${why ? ` – ${why}` : ""} (“${cur.description.slice(0, 60)}”)`,
    });
  });
}

export async function restoreFault(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx.actor, "fault.restore");
  try {
    await ctx.db.tx(async (q) => {
      const cur = await getFault(q, id);
      if (!cur) throw new NotFoundError();
      if (!cur.deletedAt) return;
      await q.query(`update faults set deleted_at = null, deleted_by = null, delete_reason = null, version = version + 1 where id = $1`, [id]);
      await audit(q, ctx, { entity: "fault", entityId: id, deviceId: cur.deviceId, action: "restore", summary: `${cur.deviceCode}: silinen arıza kaydı geri alındı` });
    });
  } catch (e) {
    if (isUniqueViolation(e, "faults_one_open_per_device")) {
      throw new ConflictError("open_fault_exists", "Bu kayıt açık bir arıza ve cihazda şu an başka bir açık arıza var. Geri almak için önce diğer kaydı kapatın.");
    }
    throw e;
  }
}

/** Kalıcı silme (yalnızca daha önce silinmiş kayıtlar). İşlem geçmişinde iz kalır. */
export async function purgeFault(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx.actor, "fault.purge");
  await ctx.db.tx(async (q) => {
    const cur = await getFault(q, id);
    if (!cur) throw new NotFoundError();
    if (!cur.deletedAt) throw new ConflictError("not_deleted", "Kalıcı silmeden önce kaydı silin (silinenler listesine taşıyın).");
    await q.query(`delete from service_visits where fault_id = $1`, [id]);
    await q.query(`delete from faults where id = $1`, [id]);
    await audit(q, ctx, {
      entity: "fault", entityId: id, deviceId: cur.deviceId, action: "purge",
      summary: `${cur.deviceCode}: arıza kaydı kalıcı olarak silindi (“${cur.description.slice(0, 60)}”, ${formatDate(cur.noticedOn)})`,
    });
  });
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

export interface FaultListItem {
  id: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  description: string;
  noticedOn: string;
  status: FaultStatus;
  causeName: string;
  causeVerification: Verification;
  noticedByStaffId: string | null;
  noticedByName: string | null;
  lastUserStaffId: string | null;
  lastUserName: string | null;
  responsibleStaffId: string | null;
  responsibleName: string | null;
  responsibilityVerifiedByStaffId: string | null;
  vendorName: string | null;
  sentOn: string | null;
  expectedReturnOn: string | null;
  outcome: Outcome | null;
  visitCount: number;
  totalCost: number | null;
  closedAt: string | null;
  deletedAt: string | null;
  deleteReason: string | null;
  deletedBy: string | null;
  deletionRequestedAt: string | null;
  deletionRequestReason: string | null;
  deletionRequestedBy: string | null;
  display: { key: FaultDisplay; label: string; tone: string };
}

export interface FaultFilters {
  view?: "acik" | "kapali" | "tumu" | "silinen" | "silme_talebi" | "serviste" | "gecikti";
  deviceId?: string;
  staffId?: string;
  causeId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export async function listFaults(q: Queryable, today: string, f: FaultFilters = {}): Promise<FaultListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  const view = f.view ?? "acik";
  if (view === "silinen") where.push("f.deleted_at is not null");
  else where.push("f.deleted_at is null");
  if (view === "acik" || view === "serviste" || view === "gecikti") where.push("f.closed_at is null");
  if (view === "serviste" || view === "gecikti") where.push("f.status = 'serviste'");
  if (view === "kapali") where.push("f.closed_at is not null");
  if (view === "silme_talebi") where.push("f.deletion_requested_at is not null");
  if (f.deviceId) add("f.device_id = ?", f.deviceId);
  if (f.causeId) add("f.cause_id = ?", f.causeId);
  if (f.from) add("f.noticed_on >= ?", f.from);
  if (f.to) add("f.noticed_on <= ?", f.to);
  if (f.staffId) {
    params.push(f.staffId);
    const n = `$${params.length}`;
    where.push(`(f.noticed_by_staff_id = ${n} or f.last_user_staff_id = ${n} or f.responsible_staff_id = ${n} or f.responsibility_verified_by_staff_id = ${n})`);
  }
  const rows = await q.query<Omit<FaultListItem, "display">>(
    `select f.id, f.device_id as "deviceId", d.inventory_code as "deviceCode", d.name as "deviceName", f.description,
       f.noticed_on as "noticedOn", f.status, c.name as "causeName", f.cause_verification as "causeVerification",
       f.noticed_by_staff_id as "noticedByStaffId", nb.full_name as "noticedByName",
       f.last_user_staff_id as "lastUserStaffId", lu.full_name as "lastUserName",
       f.responsible_staff_id as "responsibleStaffId", rs.full_name as "responsibleName",
       f.responsibility_verified_by_staff_id as "responsibilityVerifiedByStaffId",
       cv.vendor_name as "vendorName", cv.sent_on as "sentOn", cv.expected_return_on as "expectedReturnOn", cv.outcome,
       (select count(*) from service_visits v where v.fault_id = f.id and v.canceled_at is null) as "visitCount",
       (select sum(v.cost_amount) from service_visits v where v.fault_id = f.id and v.canceled_at is null) as "totalCost",
       f.closed_at as "closedAt", f.deleted_at as "deletedAt", f.delete_reason as "deleteReason", du.display_name as "deletedBy",
       f.deletion_requested_at as "deletionRequestedAt", f.deletion_request_reason as "deletionRequestReason", dru.display_name as "deletionRequestedBy"
     from faults f
     join devices d on d.id = f.device_id
     join fault_causes c on c.id = f.cause_id
     left join staff nb on nb.id = f.noticed_by_staff_id
     left join staff lu on lu.id = f.last_user_staff_id
     left join staff rs on rs.id = f.responsible_staff_id
     left join app_users du on du.id = f.deleted_by
     left join app_users dru on dru.id = f.deletion_requested_by
     left join lateral (
       select sv.name as vendor_name, v.sent_on, v.expected_return_on, v.outcome from service_visits v
       left join service_vendors sv on sv.id = v.vendor_id
       where v.fault_id = f.id and v.canceled_at is null order by v.created_at desc limit 1
     ) cv on true
     where ${where.join(" and ")}
     order by ${view === "silinen" ? "f.deleted_at desc" : "f.noticed_on desc, f.created_at desc"}`,
    params,
  );
  return rows
    .map((r) => ({ ...r, display: faultDisplay(r.status, { outcome: r.outcome, expectedReturnOn: r.expectedReturnOn }, today) }))
    .filter((r) => (view === "gecikti" ? r.display.key === "gecikti" : true))
    .filter((r) => !f.q || matchesQuery([r.deviceCode, r.deviceName, r.description, r.causeName, r.vendorName].filter(Boolean).join(" "), f.q));
}
