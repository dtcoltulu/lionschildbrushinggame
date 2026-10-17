import { deviceAvailability, type OpenFaultSummary } from "@/lib/domain";
import { LIFECYCLE_VALUES, lifecycleLabel, type Availability, type FaultStatus, type Lifecycle, type Outcome } from "@/lib/labels";
import { matchesQuery, normalizeKey } from "@/lib/normalize";
import { asBody, Reader } from "@/lib/validate";
import { audit, auditForDevice, type AuditRow, type Changes } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";
import { ConflictError, isUniqueViolation, NotFoundError, ValidationError, VersionConflictError } from "../errors";
import { assertCan, can } from "../permissions";

export interface DeviceListItem {
  id: string;
  inventoryCode: string;
  name: string;
  typeId: string;
  typeName: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  locationId: string | null;
  locationName: string | null;
  responsibleStaffId: string | null;
  responsibleName: string | null;
  responsibleActive: boolean | null;
  otherUserIds: string[];
  otherUserNames: string[];
  lifecycle: Lifecycle;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  openFault: OpenFaultSummary | null;
  availability: Availability;
}

interface Row extends Omit<DeviceListItem, "openFault" | "availability"> {
  openFaultId: string | null;
  openFaultStatus: FaultStatus | null;
  openExpectedReturnOn: string | null;
  openOutcome: Outcome | null;
}

const SELECT = `
select d.id, d.inventory_code as "inventoryCode", d.name, d.type_id as "typeId", t.name as "typeName",
  d.brand, d.model, d.serial_number as "serialNumber", d.location_id as "locationId", l.name as "locationName",
  d.responsible_staff_id as "responsibleStaffId", s.full_name as "responsibleName", s.active as "responsibleActive",
  coalesce((select array_agg(du.staff_id::text order by st.full_name) from device_users du join staff st on st.id = du.staff_id where du.device_id = d.id), '{}') as "otherUserIds",
  coalesce((select array_agg(st.full_name order by st.full_name) from device_users du join staff st on st.id = du.staff_id where du.device_id = d.id), '{}') as "otherUserNames",
  d.lifecycle, d.notes, d.version, d.created_at as "createdAt", d.updated_at as "updatedAt",
  f.id as "openFaultId", f.status as "openFaultStatus", v.expected_return_on as "openExpectedReturnOn", v.outcome as "openOutcome"
from devices d
join device_types t on t.id = d.type_id
left join locations l on l.id = d.location_id
left join staff s on s.id = d.responsible_staff_id
left join faults f on f.device_id = d.id and f.closed_at is null and f.deleted_at is null
left join lateral (
  select sv.expected_return_on, sv.outcome from service_visits sv
  where sv.fault_id = f.id and sv.canceled_at is null order by sv.created_at desc limit 1
) v on true`;

function toItem(r: Row, today: string): DeviceListItem {
  const { openFaultId, openFaultStatus, openExpectedReturnOn, openOutcome, ...rest } = r;
  const openFault: OpenFaultSummary | null = openFaultId
    ? { id: openFaultId, status: openFaultStatus!, expectedReturnOn: openExpectedReturnOn, outcome: openOutcome }
    : null;
  return { ...rest, openFault, availability: deviceAvailability(r.lifecycle, openFault, today) };
}

export interface DeviceFilters {
  q?: string;
  typeId?: string;
  locationId?: string;
  /** Kullanılabilirlik filtresi; "tum" envanterden çıkarılanlar dahil hepsi. */
  durum?: string;
  staffId?: string;
}

export const DEVICE_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Envanterdeki tüm cihazlar" },
  { value: "kullanilabilir", label: "Kullanılabilir" },
  { value: "kullanilamaz", label: "Şu an kullanılamayan (arızalı, serviste, kullanım dışı…)" },
  { value: "arizali", label: "Arızalı" },
  { value: "serviste", label: "Serviste (gecikenler dahil)" },
  { value: "gecikti", label: "Servisi gecikmiş" },
  { value: "sorun", label: "Tamirden geldi – sorun devam ediyor / denenmedi" },
  { value: "kullanim_disi", label: "Kullanım dışı (manuel)" },
  { value: "cikarildi", label: "Envanterden çıkarılanlar" },
  { value: "tum", label: "Tümü (çıkarılanlar dahil)" },
];

function statusMatch(a: Availability, durum: string | undefined): boolean {
  switch (durum ?? "") {
    case "":
      return a !== "cikarildi";
    case "tum":
      return true;
    case "kullanilamaz":
      return a !== "kullanilabilir" && a !== "cikarildi";
    case "serviste":
      return a === "serviste" || a === "gecikti";
    case "sorun":
      return a === "sorun_devam" || a === "denenmedi";
    default:
      return a === durum;
  }
}

/** Liste küçük (yüzlerce cihaz) olduğundan arama Türkçe kurallarıyla uygulamada yapılır. */
export async function listDevices(q: Queryable, today: string, f: DeviceFilters = {}): Promise<DeviceListItem[]> {
  const rows = (await q.query<Row>(`${SELECT} order by d.inventory_code`)).map((r) => toItem(r, today));
  return rows.filter((d) => {
    if (f.typeId && d.typeId !== f.typeId) return false;
    if (f.locationId && d.locationId !== f.locationId) return false;
    if (f.staffId && d.responsibleStaffId !== f.staffId && !d.otherUserIds.includes(f.staffId)) return false;
    if (!statusMatch(d.availability, f.durum)) return false;
    if (f.q) {
      const hay = [d.inventoryCode, d.name, d.typeName, d.brand, d.model, d.serialNumber, d.responsibleName, d.locationName, ...d.otherUserNames]
        .filter(Boolean)
        .join(" ");
      if (!matchesQuery(hay, f.q)) return false;
    }
    return true;
  });
}

export async function getDevice(q: Queryable, today: string, id: string): Promise<DeviceListItem | null> {
  const rows = await q.query<Row>(`${SELECT} where d.id = $1`, [id]);
  return rows[0] ? toItem(rows[0], today) : null;
}

export async function findDeviceByCode(q: Queryable, code: string): Promise<string | null> {
  const rows = await q.query<{ id: string }>(`select id from devices where inventory_code = $1`, [normalizeCode(code)]);
  return rows[0]?.id ?? null;
}

export async function deviceHistory(q: Queryable, id: string): Promise<AuditRow[]> {
  return auditForDevice(q, id);
}

/** "aer-1", " Aer-001 " → "AER-1" / "AER-001" (Türkçe harfler sadeleştirilir). */
export function normalizeCode(v: string): string {
  return v
    .trim()
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "-");
}

const CODE_RE = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export async function suggestCode(q: Queryable, typeId: string): Promise<string | null> {
  const [t] = await q.query<{ prefix: string; digits: number }>(`select code_prefix as prefix, code_digits as digits from device_types where id = $1`, [typeId]);
  if (!t) return null;
  const rows = await q.query<{ code: string }>(`select inventory_code as code from devices where inventory_code like $1`, [`${t.prefix}-%`]);
  let max = 0;
  const re = new RegExp(`^${t.prefix}-(\\d+)$`);
  for (const r of rows) {
    const m = re.exec(r.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${t.prefix}-${String(max + 1).padStart(t.digits, "0")}`;
}

interface DeviceInput {
  name: string;
  typeId: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  locationId: string | null;
  responsibleStaffId: string | null;
  otherUserIds: string[];
  notes: string | null;
  lifecycle: Lifecycle;
  inventoryCode: string | null;
}

/** Güncellemede gövdede olmayan alanlar mevcut değerini korur. */
function parse(body: Record<string, unknown>, existing: DeviceListItem | null): DeviceInput {
  const r = new Reader(body);
  const keep = <T>(field: keyof DeviceListItem & string, read: () => T): T => (!existing || r.has(field) ? read() : (existing[field] as T));
  const out: DeviceInput = {
    name: keep("name", () => r.text("name", "Cihaz adı", { max: 120 })),
    typeId: keep("typeId", () => r.id("typeId", "Cihaz türü")),
    brand: keep("brand", () => r.optText("brand", "Marka", { max: 80 })),
    model: keep("model", () => r.optText("model", "Model", { max: 80 })),
    serialNumber: keep("serialNumber", () => r.optText("serialNumber", "Seri numarası", { max: 80 })),
    locationId: keep("locationId", () => r.optId("locationId", "Oda / ünit")),
    responsibleStaffId: keep("responsibleStaffId", () => r.optId("responsibleStaffId", "Sorumlu çalışan")),
    otherUserIds: keep("otherUserIds", () => r.ids("otherUserIds", "Diğer kullanıcılar")),
    notes: keep("notes", () => r.optText("notes", "Notlar", { multiline: true, max: 2000 })),
    lifecycle: r.oneOf("lifecycle", "Durum", LIFECYCLE_VALUES, existing?.lifecycle ?? "aktif"),
    inventoryCode: null,
  };
  const rawCode = typeof body.inventoryCode === "string" ? normalizeCode(body.inventoryCode) : "";
  if (rawCode) {
    if (!CODE_RE.test(rawCode) || rawCode.length > 20) {
      r.error("inventoryCode", "Envanter kodu yalnızca harf (A–Z), rakam ve tire içerebilir (en fazla 20 karakter). Örn. AER-004");
    } else out.inventoryCode = rawCode;
  }
  if (!r.ok) throw new ValidationError(r.errors);
  return out;
}

/** Seçilen kayıtların var olduğunu doğrular (yabancı anahtar hatası yerine anlaşılır alan mesajı). */
async function assertRefs(q: Queryable, p: DeviceInput) {
  const errors: Record<string, string> = {};
  const [t] = await q.query<{ id: string }>(`select id from device_types where id = $1`, [p.typeId]);
  if (!t) errors.typeId = "Cihaz türü bulunamadı. Listeden tekrar seçin.";
  if (p.locationId && !(await q.query(`select 1 from locations where id = $1`, [p.locationId])).length) {
    errors.locationId = "Oda / ünit bulunamadı. Listeden tekrar seçin.";
  }
  const people = [p.responsibleStaffId, ...p.otherUserIds].filter(Boolean) as string[];
  if (people.length) {
    const found = new Set((await q.query<{ id: string }>(`select id from staff where id = any($1::uuid[])`, [people])).map((r) => r.id));
    if (p.responsibleStaffId && !found.has(p.responsibleStaffId)) errors.responsibleStaffId = "Sorumlu çalışan bulunamadı. Listeden tekrar seçin.";
    if (p.otherUserIds.some((x) => !found.has(x))) errors.otherUserIds = "Diğer kullanıcılardan biri bulunamadı.";
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
}

async function assertSerialUnique(q: Queryable, serial: string | null, exceptId: string | null, confirmed: boolean) {
  if (!serial || confirmed) return;
  const rows = await q.query<{ id: string; inventoryCode: string; name: string; serialNumber: string }>(
    `select id, inventory_code as "inventoryCode", name, serial_number as "serialNumber" from devices where serial_number is not null and ($1::uuid is null or id <> $1)`,
    [exceptId],
  );
  const key = normalizeKey(serial).replace(/ /g, "");
  const same = rows.find((r) => normalizeKey(r.serialNumber).replace(/ /g, "") === key);
  if (same) {
    const msg = `Bu seri numarası ${same.inventoryCode} (${same.name}) cihazında kayıtlı. Aynı cihazsa yeni kart açmayın; farklıysa “Yine de kaydet”i işaretleyin.`;
    throw new ConflictError("duplicate_serial", msg, { existing: same }, { serialNumber: msg });
  }
}

async function names(q: Queryable, table: "locations" | "staff" | "device_types", ids: (string | null)[]): Promise<Map<string, string>> {
  const list = ids.filter(Boolean) as string[];
  if (!list.length) return new Map();
  const col = table === "staff" ? "full_name" : "name";
  const rows = await q.query<{ id: string; name: string }>(`select id, ${col} as name from ${table} where id = any($1::uuid[])`, [list]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Aynı türden birden fazla cihaz (ör. 3 aeratör) tek seferde eklenebilir; her biri ayrı kart ve ayrı koddur. */
export async function createDevices(ctx: Ctx, input: unknown): Promise<{ ids: string[]; codes: string[] }> {
  assertCan(ctx.actor, "device.create");
  const body = asBody(input);
  const r = new Reader(body);
  const quantity = r.int("quantity", "Adet", 1, 20, 1);
  if (!r.ok) throw new ValidationError(r.errors);
  const p = parse(body, null);
  if (p.lifecycle === "envanterden_cikarildi") throw new ValidationError({ lifecycle: "Yeni cihaz “Envanterden çıkarıldı” durumunda eklenemez." });
  if (quantity > 1 && p.inventoryCode) throw new ValidationError({ inventoryCode: "Birden fazla cihaz eklerken kodlar otomatik verilir; kod alanını boş bırakın." });
  if (quantity > 1 && p.serialNumber) throw new ValidationError({ serialNumber: "Birden fazla cihaz eklerken seri numarasını boş bırakın; cihazları ekledikten sonra her birine ayrı girin." });

  for (let attempt = 0; ; attempt++) {
    try {
      return await ctx.db.tx(async (q) => {
        await assertRefs(q, p);
        await assertSerialUnique(q, p.serialNumber, null, body.confirmDuplicateSerial === true);
        const ids: string[] = [];
        const codes: string[] = [];
        for (let i = 0; i < quantity; i++) {
          const code = p.inventoryCode ?? (await suggestCode(q, p.typeId))!;
          const [row] = await q.query<{ id: string }>(
            `insert into devices (inventory_code, name, type_id, brand, model, serial_number, location_id, responsible_staff_id, notes, lifecycle, created_by, updated_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) returning id`,
            [code, p.name, p.typeId, p.brand, p.model, p.serialNumber, p.locationId, p.responsibleStaffId, p.notes, p.lifecycle, ctx.actor.userId],
          );
          for (const sid of p.otherUserIds) await q.query(`insert into device_users (device_id, staff_id) values ($1, $2)`, [row!.id, sid]);
          await audit(q, ctx, { entity: "device", entityId: row!.id, deviceId: row!.id, action: "create", summary: `Cihaz kaydı açıldı: ${code} – ${p.name}` });
          ids.push(row!.id);
          codes.push(code);
        }
        return { ids, codes };
      });
    } catch (e) {
      if (isUniqueViolation(e, "devices_inventory_code_uq")) {
        // Elle girilen kod çakıştıysa kullanıcıya söyle; otomatik kodda (aynı anda iki kayıt) yeniden dene.
        if (p.inventoryCode) throw new ValidationError({ inventoryCode: `${p.inventoryCode} kodu başka bir cihazda kullanılıyor.` });
        if (attempt < 3) continue;
      }
      throw e;
    }
  }
}

export async function updateDevice(ctx: Ctx, id: string, input: unknown): Promise<DeviceListItem> {
  assertCan(ctx.actor, "device.edit");
  const body = asBody(input);
  const version = new Reader(body).version();
  try {
    return await ctx.db.tx(async (q) => {
      const existing = await getDevice(q, ctx.today, id);
      if (!existing) throw new NotFoundError("Cihaz bulunamadı.");
      const p = parse(body, existing);
      const code = p.inventoryCode ?? existing.inventoryCode;
      if (code !== existing.inventoryCode) assertCan(ctx.actor, "device.recode");
      if ((p.lifecycle === "envanterden_cikarildi") !== (existing.lifecycle === "envanterden_cikarildi")) assertCan(ctx.actor, "device.retire");
      await assertRefs(q, p);
      if ((p.serialNumber ?? "") !== (existing.serialNumber ?? "")) {
        await assertSerialUnique(q, p.serialNumber, id, body.confirmDuplicateSerial === true);
      }
      const rows = await q.query(
        `update devices set inventory_code = $3, name = $4, type_id = $5, brand = $6, model = $7, serial_number = $8, location_id = $9,
           responsible_staff_id = $10, notes = $11, lifecycle = $12, updated_by = $13, updated_at = now(), version = version + 1
         where id = $1 and version = $2 returning id`,
        [id, version, code, p.name, p.typeId, p.brand, p.model, p.serialNumber, p.locationId, p.responsibleStaffId, p.notes, p.lifecycle, ctx.actor.userId],
      );
      if (!rows.length) throw new VersionConflictError({ current: existing });
      const before = new Set(existing.otherUserIds);
      const after = new Set(p.otherUserIds);
      for (const sid of before) if (!after.has(sid)) await q.query(`delete from device_users where device_id = $1 and staff_id = $2`, [id, sid]);
      for (const sid of after) if (!before.has(sid)) await q.query(`insert into device_users (device_id, staff_id) values ($1, $2)`, [id, sid]);

      // Geçmişte okunabilir kalsın diye kişi/konum/tür değişiklikleri AD olarak yazılır.
      const locNames = await names(q, "locations", [existing.locationId, p.locationId]);
      const staffNames = await names(q, "staff", [existing.responsibleStaffId, p.responsibleStaffId, ...before, ...after]);
      const typeNames = await names(q, "device_types", [existing.typeId, p.typeId]);
      const changes: Changes = {};
      const add = (field: string, label: string, from: unknown, to: unknown) => {
        const a = from ?? null;
        const b = to ?? null;
        if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = { label, from: a, to: b };
      };
      add("inventoryCode", "Envanter kodu", existing.inventoryCode, code);
      add("name", "Cihaz adı", existing.name, p.name);
      add("type", "Cihaz türü", typeNames.get(existing.typeId), typeNames.get(p.typeId));
      add("brand", "Marka", existing.brand, p.brand);
      add("model", "Model", existing.model, p.model);
      add("serialNumber", "Seri numarası", existing.serialNumber, p.serialNumber);
      add("location", "Oda / ünit", existing.locationId && locNames.get(existing.locationId), p.locationId && locNames.get(p.locationId));
      add("responsible", "Sorumlu çalışan", existing.responsibleStaffId && staffNames.get(existing.responsibleStaffId), p.responsibleStaffId && staffNames.get(p.responsibleStaffId));
      add("otherUsers", "Diğer kullanıcılar", [...before].map((s) => staffNames.get(s)).sort(), [...after].map((s) => staffNames.get(s)).sort());
      add("notes", "Notlar", existing.notes, p.notes);
      add("lifecycle", "Durum", lifecycleLabel(existing.lifecycle), lifecycleLabel(p.lifecycle));
      if (Object.keys(changes).length) {
        const kinds = [changes.location && "konum", changes.responsible && "sorumlu", changes.lifecycle && "durum"].filter(Boolean);
        const summary = kinds.length
          ? `${code}: ${kinds.join(", ")} değişti`
          : `${code}: cihaz bilgileri güncellendi`;
        await audit(q, ctx, { entity: "device", entityId: id, deviceId: id, action: "update", summary, changes });
      }
      return (await getDevice(q, ctx.today, id))!;
    });
  } catch (e) {
    if (isUniqueViolation(e, "devices_inventory_code_uq")) {
      throw new ValidationError({ inventoryCode: "Bu envanter kodu başka bir cihazda kullanılıyor." });
    }
    throw e;
  }
}

export function canRetire(actor: Ctx["actor"]) {
  return can(actor, "device.retire");
}
