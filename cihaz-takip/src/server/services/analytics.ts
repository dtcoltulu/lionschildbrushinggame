import { addMonths, isoToIstanbulDate, monthKey, monthRange } from "@/lib/dates";
import { deviceAvailability } from "@/lib/domain";
import type { Lifecycle } from "@/lib/labels";
import type { Queryable } from "../db";

/**
 * Yönetim analizleri. Ortak kurallar:
 *  - Silinen arızalar ve iptal edilen (yanlışlıkla açılan) servis gidişleri hiçbir sayıya girmez.
 *  - "Arıza bildirimi" ile "tamire gidiş" ayrı ölçülür: servise gitmemiş arıza gidiş sayısını artırmaz,
 *    bir gidişin güncellenmesi yeni gidiş sayılmaz (gidiş = service_visits satırı).
 *  - Maliyet MASRAF TARİHİNE göre aya yazılır; masraf tarihi olmayan tutar hiçbir aya atanmaz ("Tarihi eksik").
 *  - Tutarı bilinmeyen (boş) ile ücretsiz (0 TL) ayrıdır.
 *  - Kişi bazlı sıralama (ör. "arızayı en çok bulan") üretilmez.
 */

export interface Period {
  from: string | null;
  to: string | null;
}

export const ALL_TIME: Period = { from: null, to: null };

function inPeriod(date: string | null, p: Period): boolean {
  if (!date) return false;
  if (p.from && date < p.from) return false;
  if (p.to && date > p.to) return false;
  return true;
}

const isAllTime = (p: Period) => !p.from && !p.to;

interface FaultRow {
  id: string;
  deviceId: string;
  noticedOn: string;
  causeId: string;
  causeName: string;
  causeSystemKey: string | null;
  causeVerification: string;
}

interface VisitRow {
  id: string;
  faultId: string;
  deviceId: string;
  sentOn: string | null;
  createdAt: string;
  returned: boolean;
  costAmount: number | null;
  costDate: string | null;
  vendorName: string | null;
  receiptRef: string | null;
  deviceCode: string;
  deviceName: string;
}

async function loadFaults(q: Queryable): Promise<FaultRow[]> {
  return q.query<FaultRow>(
    `select f.id, f.device_id as "deviceId", f.noticed_on as "noticedOn", f.cause_id as "causeId", c.name as "causeName",
       c.system_key as "causeSystemKey", f.cause_verification as "causeVerification"
     from faults f join fault_causes c on c.id = f.cause_id where f.deleted_at is null`,
  );
}

async function loadVisits(q: Queryable): Promise<VisitRow[]> {
  return q.query<VisitRow>(
    `select v.id, v.fault_id as "faultId", f.device_id as "deviceId", v.sent_on as "sentOn", v.created_at as "createdAt",
       v.returned, v.cost_amount as "costAmount", v.cost_date as "costDate", sv.name as "vendorName", v.receipt_ref as "receiptRef",
       d.inventory_code as "deviceCode", d.name as "deviceName"
     from service_visits v
     join faults f on f.id = v.fault_id
     join devices d on d.id = f.device_id
     left join service_vendors sv on sv.id = v.vendor_id
     where v.canceled_at is null and f.deleted_at is null`,
  );
}

/** Gidişin hangi döneme sayılacağı: gönderim tarihi; girilmemişse kaydın açıldığı gün. */
export function tripDate(v: { sentOn: string | null; createdAt: string }): string {
  return v.sentOn ?? isoToIstanbulDate(v.createdAt);
}

// ---------------------------------------------------------------------------
// A. En sık tamire giden cihazlar
// ---------------------------------------------------------------------------

export interface DeviceRepairRow {
  deviceId: string;
  inventoryCode: string;
  name: string;
  typeName: string;
  brand: string | null;
  model: string | null;
  responsibleName: string | null;
  lifecycle: Lifecycle;
  tripCount: number;
  faultCount: number;
  totalCost: number;
  /** Tutarı girilmiş (0 TL dahil) gidiş sayısı; 0 ise maliyet "bilinmiyor"dur, ücretsiz değil. */
  costCount: number;
  undatedCost: number;
  unknownCostTrips: number;
}

export async function deviceRepairStats(q: Queryable, p: Period): Promise<{ rows: DeviceRepairRow[]; tripsWithoutSentOn: number }> {
  const devices = await q.query<Omit<DeviceRepairRow, "tripCount" | "faultCount" | "totalCost" | "costCount" | "undatedCost" | "unknownCostTrips">>(
    `select d.id as "deviceId", d.inventory_code as "inventoryCode", d.name, t.name as "typeName", d.brand, d.model,
       s.full_name as "responsibleName", d.lifecycle
     from devices d join device_types t on t.id = d.type_id left join staff s on s.id = d.responsible_staff_id`,
  );
  const faults = await loadFaults(q);
  const visits = await loadVisits(q);
  const all = isAllTime(p);
  const map = new Map<string, DeviceRepairRow>();
  for (const d of devices) map.set(d.deviceId, { ...d, tripCount: 0, faultCount: 0, totalCost: 0, costCount: 0, undatedCost: 0, unknownCostTrips: 0 });
  for (const f of faults) if (all || inPeriod(f.noticedOn, p)) map.get(f.deviceId)!.faultCount++;
  let tripsWithoutSentOn = 0;
  for (const v of visits) {
    const row = map.get(v.deviceId)!;
    if (all || inPeriod(tripDate(v), p)) {
      row.tripCount++;
      if (!v.sentOn) tripsWithoutSentOn++;
      if (v.returned && v.costAmount === null) row.unknownCostTrips++;
    }
    if (v.costAmount !== null) {
      if (v.costDate && (all || inPeriod(v.costDate, p))) {
        row.totalCost += v.costAmount;
        row.costCount++;
      } else if (!v.costDate) {
        row.undatedCost += v.costAmount;
        if (all) row.costCount++;
      }
    }
  }
  const rows = [...map.values()]
    .filter((r) => r.tripCount > 0 || r.faultCount > 0 || r.totalCost > 0)
    .map((r) => ({ ...r, totalCost: all ? r.totalCost + r.undatedCost : r.totalCost }))
    .sort((a, b) => b.tripCount - a.tripCount || b.faultCount - a.faultCount || b.totalCost - a.totalCost || a.inventoryCode.localeCompare(b.inventoryCode));
  return { rows, tripsWithoutSentOn };
}

// ---------------------------------------------------------------------------
// B. Tamir maliyeti
// ---------------------------------------------------------------------------

export interface MonthCost {
  month: string;
  total: number;
  count: number;
  freeCount: number;
}

export interface CostReport {
  thisMonth: string;
  thisMonthTotal: number;
  months: MonthCost[];
  periodTotal: number;
  periodCount: number;
  periodFreeCount: number;
  byDevice: { deviceId: string; deviceCode: string; deviceName: string; total: number; count: number }[];
  /** Tutarı girilmiş ama masraf tarihi olmayan kayıtlar (hiçbir aya yazılmadı). */
  undated: { visitId: string; faultId: string; deviceCode: string; deviceName: string; amount: number }[];
  undatedTotal: number;
  /** Tamirden dönmüş ama tutarı girilmemiş kayıtlar (ücretsiz SAYILMAZ). */
  unknownAmount: { visitId: string; faultId: string; deviceCode: string; deviceName: string; vendorName: string | null }[];
}

/** Ay ay karşılaştırma için dönem (verilmezse son 12 ay). */
export function monthsFor(p: Period, today: string): string[] {
  const to = monthKey(p.to ?? today);
  const from = p.from ? monthKey(p.from) : addMonths(to, -11);
  return monthRange(from, to);
}

export async function costReport(q: Queryable, p: Period, today: string): Promise<CostReport> {
  const visits = await loadVisits(q);
  const thisMonth = monthKey(today);
  const months = new Map(monthsFor(p, today).map((m) => [m, { month: m, total: 0, count: 0, freeCount: 0 }]));
  const byDevice = new Map<string, CostReport["byDevice"][number]>();
  let thisMonthTotal = 0;
  let periodTotal = 0;
  let periodCount = 0;
  let periodFreeCount = 0;
  const undated: CostReport["undated"] = [];
  const unknownAmount: CostReport["unknownAmount"] = [];
  for (const v of visits) {
    if (v.costAmount === null) {
      if (v.returned) unknownAmount.push({ visitId: v.id, faultId: v.faultId, deviceCode: v.deviceCode, deviceName: v.deviceName, vendorName: v.vendorName });
      continue;
    }
    if (!v.costDate) {
      undated.push({ visitId: v.id, faultId: v.faultId, deviceCode: v.deviceCode, deviceName: v.deviceName, amount: v.costAmount });
      continue;
    }
    const m = monthKey(v.costDate);
    if (m === thisMonth) thisMonthTotal += v.costAmount;
    const bucket = months.get(m);
    if (bucket) {
      bucket.total += v.costAmount;
      bucket.count++;
      if (v.costAmount === 0) bucket.freeCount++;
    }
    if (isAllTime(p) || inPeriod(v.costDate, p)) {
      periodTotal += v.costAmount;
      periodCount++;
      if (v.costAmount === 0) periodFreeCount++;
      const d = byDevice.get(v.deviceId) ?? { deviceId: v.deviceId, deviceCode: v.deviceCode, deviceName: v.deviceName, total: 0, count: 0 };
      d.total += v.costAmount;
      d.count++;
      byDevice.set(v.deviceId, d);
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    thisMonth,
    thisMonthTotal: round(thisMonthTotal),
    months: [...months.values()].map((m) => ({ ...m, total: round(m.total) })),
    periodTotal: round(periodTotal),
    periodCount,
    periodFreeCount,
    byDevice: [...byDevice.values()].map((d) => ({ ...d, total: round(d.total) })).sort((a, b) => b.total - a.total || a.deviceCode.localeCompare(b.deviceCode)),
    undated,
    undatedTotal: round(undated.reduce((s, u) => s + u.amount, 0)),
    unknownAmount,
  };
}

// ---------------------------------------------------------------------------
// C. Arıza nedenleri
// ---------------------------------------------------------------------------

export interface CauseRow {
  causeId: string;
  causeName: string;
  undetermined: boolean;
  total: number;
  preliminary: number;
  verifiedByService: number;
  verifiedByClinic: number;
}

export async function causeStats(q: Queryable, p: Period): Promise<{ rows: CauseRow[]; total: number; undetermined: number; verified: number; preliminary: number }> {
  const faults = (await loadFaults(q)).filter((f) => isAllTime(p) || inPeriod(f.noticedOn, p));
  const map = new Map<string, CauseRow>();
  for (const f of faults) {
    const r = map.get(f.causeId) ?? {
      causeId: f.causeId, causeName: f.causeName, undetermined: f.causeSystemKey === "belirlenmedi",
      total: 0, preliminary: 0, verifiedByService: 0, verifiedByClinic: 0,
    };
    r.total++;
    if (f.causeVerification === "servis_dogruladi") r.verifiedByService++;
    else if (f.causeVerification === "klinik_dogruladi") r.verifiedByClinic++;
    else r.preliminary++;
    map.set(f.causeId, r);
  }
  const rows = [...map.values()].sort((a, b) => Number(a.undetermined) - Number(b.undetermined) || b.total - a.total || a.causeName.localeCompare(b.causeName, "tr"));
  return {
    rows,
    total: faults.length,
    undetermined: rows.filter((r) => r.undetermined).reduce((s, r) => s + r.total, 0),
    verified: rows.reduce((s, r) => s + r.verifiedByService + r.verifiedByClinic, 0),
    preliminary: rows.reduce((s, r) => s + r.preliminary, 0),
  };
}

// ---------------------------------------------------------------------------
// Genel bakış
// ---------------------------------------------------------------------------

export interface Overview {
  totalDevices: number;
  unusable: number;
  unusableBreakdown: { arizali: number; serviste: number; sorun: number; kullanimDisi: number };
  inService: number;
  overdue: number;
  thisMonthCost: number;
  openFaults: number;
  deletionRequests: number;
}

export async function overview(q: Queryable, today: string): Promise<Overview> {
  const rows = await q.query<{ lifecycle: Lifecycle; status: string | null; expected: string | null; outcome: string | null }>(
    `select d.lifecycle, f.status, v.expected_return_on as expected, v.outcome
     from devices d
     left join faults f on f.device_id = d.id and f.closed_at is null and f.deleted_at is null
     left join lateral (select expected_return_on, outcome from service_visits sv where sv.fault_id = f.id and sv.canceled_at is null order by sv.created_at desc limit 1) v on true
     where d.lifecycle <> 'envanterden_cikarildi'`,
  );
  const o: Overview = {
    totalDevices: rows.length, unusable: 0, unusableBreakdown: { arizali: 0, serviste: 0, sorun: 0, kullanimDisi: 0 },
    inService: 0, overdue: 0, thisMonthCost: 0, openFaults: 0, deletionRequests: 0,
  };
  for (const r of rows) {
    const a = deviceAvailability(
      r.lifecycle,
      r.status ? { id: "", status: r.status as never, expectedReturnOn: r.expected, outcome: r.outcome as never } : null,
      today,
    );
    if (a === "kullanilabilir") continue;
    o.unusable++;
    if (a === "arizali") o.unusableBreakdown.arizali++;
    else if (a === "serviste" || a === "gecikti") o.unusableBreakdown.serviste++;
    else if (a === "sorun_devam" || a === "denenmedi") o.unusableBreakdown.sorun++;
    else if (a === "kullanim_disi") o.unusableBreakdown.kullanimDisi++;
  }
  const [s] = await q.query<{ inService: number; overdue: number; openFaults: number; deletionRequests: number }>(
    `select
       count(*) filter (where f.status = 'serviste' and f.closed_at is null) as "inService",
       count(*) filter (where f.status = 'serviste' and f.closed_at is null and v.expected_return_on < $1::date) as "overdue",
       count(*) filter (where f.closed_at is null) as "openFaults",
       count(*) filter (where f.deletion_requested_at is not null) as "deletionRequests"
     from faults f
     left join lateral (select expected_return_on from service_visits sv where sv.fault_id = f.id and sv.canceled_at is null order by sv.created_at desc limit 1) v on true
     where f.deleted_at is null`,
    [today],
  );
  Object.assign(o, s);
  const cost = await costReport(q, ALL_TIME, today);
  o.thisMonthCost = cost.thisMonthTotal;
  return o;
}
