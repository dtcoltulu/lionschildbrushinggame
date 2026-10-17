import { formatDate, formatDateTime, monthLabel } from "@/lib/dates";
import { faultStatusLabel, jobRoleLabel, lifecycleLabel, outcomeLabel, verificationLabel, AVAILABILITY_LABELS } from "@/lib/labels";
import type { Ctx } from "../context";
import { NotFoundError } from "../errors";
import { assertCan } from "../permissions";
import { ALL_TIME, costReport, type Period } from "./analytics";
import { listDevices } from "./devices";
import { listStaff } from "./staff";

/** Türkçe Excel varsayılanı noktalı virgüldür; UTF-8 BOM Türkçe karakterleri korur. */
const SEP = ";";
const BOM = "﻿";

type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v).replace(".", ",");
  let s = v;
  // Excel formül enjeksiyonuna karşı
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(SEP)).join("\r\n") + "\r\n";
}

export const EXPORTS = {
  cihazlar: "Cihaz envanteri",
  arizalar: "Arıza kayıtları",
  "servis-gidisleri": "Servis gidişleri ve maliyetler",
  "aylik-maliyet": "Aylık tamir maliyeti",
  calisanlar: "Çalışanlar",
} as const;
export type ExportKind = keyof typeof EXPORTS;

export async function exportCsv(ctx: Ctx, kind: string, period: Period = ALL_TIME): Promise<{ filename: string; body: string }> {
  assertCan(ctx.actor, "export");
  const q = ctx.db;
  const stamp = ctx.today;
  switch (kind) {
    case "cihazlar": {
      const devices = await listDevices(q, ctx.today, { durum: "tum" });
      const rows: Cell[][] = [["Envanter kodu", "Cihaz adı", "Tür", "Marka", "Model", "Seri numarası", "Oda / ünit", "Sorumlu", "Diğer kullanıcılar", "Kayıt durumu", "Şu anki durum", "Notlar"]];
      for (const d of devices) {
        rows.push([d.inventoryCode, d.name, d.typeName, d.brand, d.model, d.serialNumber, d.locationName, d.responsibleName, d.otherUserNames.join(", "),
          lifecycleLabel(d.lifecycle), AVAILABILITY_LABELS[d.availability], d.notes]);
      }
      return { filename: `cihazlar-${stamp}.csv`, body: toCsv(rows) };
    }
    case "arizalar": {
      const faults = await q.query<Record<string, string | number | null>>(
        `select d.inventory_code, d.name as device_name, f.description, f.noticed_on, nb.full_name as noticed_by, lu.full_name as last_user,
           l.name as location, c.name as cause, f.cause_detail, f.cause_verification, rs.full_name as responsible, f.responsibility_evidence,
           rv.full_name as verified_by, f.status, f.resolution_note, f.closed_at, f.created_at,
           (select count(*) from service_visits v where v.fault_id = f.id and v.canceled_at is null) as trips,
           (select sum(cost_amount) from service_visits v where v.fault_id = f.id and v.canceled_at is null) as cost,
           (select v.outcome from service_visits v where v.fault_id = f.id and v.canceled_at is null order by v.created_at desc limit 1) as outcome
         from faults f join devices d on d.id = f.device_id join fault_causes c on c.id = f.cause_id
         left join staff nb on nb.id = f.noticed_by_staff_id left join staff lu on lu.id = f.last_user_staff_id
         left join staff rs on rs.id = f.responsible_staff_id left join staff rv on rv.id = f.responsibility_verified_by_staff_id
         left join locations l on l.id = f.location_id
         where f.deleted_at is null order by f.noticed_on, d.inventory_code`,
      );
      const rows: Cell[][] = [["Envanter kodu", "Cihaz", "Arıza açıklaması", "Fark edildiği tarih", "Fark eden", "Son bilinen kullanıcı", "Arıza anındaki konum",
        "Arıza nedeni", "Neden açıklaması", "Neden doğrulama", "Doğrulanmış sorumlu", "Tespit / kanıt", "Doğrulayan", "Durum", "Son dönüş sonucu",
        "Açık / kapalı", "Kapanış", "Tamire gidiş sayısı", "Toplam maliyet (TL)", "Çözüm notu", "Kayıt zamanı"]];
      for (const f of faults) {
        rows.push([f.inventory_code, f.device_name, f.description, formatDate(f.noticed_on as string), f.noticed_by, f.last_user, f.location, f.cause, f.cause_detail,
          verificationLabel(f.cause_verification as string), f.responsible, f.responsibility_evidence, f.verified_by, faultStatusLabel(f.status as string),
          f.outcome ? outcomeLabel(f.outcome as string) : "", f.closed_at ? "Kapalı" : "Açık", formatDateTime(f.closed_at as string | null), f.trips,
          f.cost, f.resolution_note, formatDateTime(f.created_at as string)]);
      }
      return { filename: `arizalar-${stamp}.csv`, body: toCsv(rows) };
    }
    case "servis-gidisleri": {
      const visits = await q.query<Record<string, string | number | boolean | null>>(
        `select d.inventory_code, d.name as device_name, f.description, sv.name as vendor, v.sent_on, v.expected_return_on, v.returned, v.returned_on,
           v.work_done, v.cost_amount, v.cost_date, v.receipt_ref, v.outcome, v.service_note
         from service_visits v join faults f on f.id = v.fault_id join devices d on d.id = f.device_id
         left join service_vendors sv on sv.id = v.vendor_id
         where v.canceled_at is null and f.deleted_at is null order by coalesce(v.sent_on, v.created_at::date), d.inventory_code`,
      );
      const rows: Cell[][] = [["Envanter kodu", "Cihaz", "Arıza", "Servis firması", "Gönderim", "Beklenen dönüş", "Döndü mü", "Gerçek dönüş", "Yapılan işlem",
        "Maliyet (TL)", "Maliyet durumu", "Masraf tarihi", "Masraf ayı", "Rapor / fiş", "Sonuç", "Servis notu"]];
      for (const v of visits) {
        const amount = v.cost_amount as number | null;
        const costState = amount === null ? (v.returned ? "Tutar eksik" : "") : amount === 0 ? "Ücretsiz" : "";
        rows.push([v.inventory_code as string, v.device_name as string, v.description as string, v.vendor as string, formatDate(v.sent_on as string | null),
          formatDate(v.expected_return_on as string | null), v.returned ? "Evet" : "Hayır", formatDate(v.returned_on as string | null), v.work_done as string,
          amount, costState, v.cost_date ? formatDate(v.cost_date as string) : amount !== null ? "Tarihi eksik" : "",
          v.cost_date ? monthLabel((v.cost_date as string).slice(0, 7)) : "", v.receipt_ref as string, v.outcome ? outcomeLabel(v.outcome as string) : "",
          v.service_note as string]);
      }
      return { filename: `servis-gidisleri-${stamp}.csv`, body: toCsv(rows) };
    }
    case "aylik-maliyet": {
      const r = await costReport(q, period, ctx.today);
      const rows: Cell[][] = [["Ay", "Toplam tamir maliyeti (TL)", "Maliyetli kayıt", "Ücretsiz (0 TL) kayıt"]];
      for (const m of r.months) rows.push([monthLabel(m.month), m.total, m.count, m.freeCount]);
      rows.push([], ["Tarihi eksik tutarlar (hiçbir aya yazılmadı)", r.undatedTotal, r.undated.length, ""]);
      rows.push(["Tutarı girilmemiş tamir dönüşleri", "", r.unknownAmount.length, ""]);
      return { filename: `aylik-maliyet-${stamp}.csv`, body: toCsv(rows) };
    }
    case "calisanlar": {
      const staff = await listStaff(q, { includeInactive: true });
      const rows: Cell[][] = [["Ad soyad", "Görev", "Durum", "İlgili oda / ünit", "İş e-postası", "Uygulama hesabı var mı", "Not"]];
      for (const s of staff) rows.push([s.fullName, jobRoleLabel(s.jobRole), s.active ? "Aktif" : "Pasif", s.locationName, s.workEmail, s.hasLogin ? "Evet" : "Hayır", s.note]);
      return { filename: `calisanlar-${stamp}.csv`, body: toCsv(rows) };
    }
    default:
      throw new NotFoundError("Bilinmeyen dışa aktarım türü.");
  }
}
