import { formatQty, isPositive } from "@/lib/decimal";
import { audit } from "../audit";
import type { Ctx } from "../context";
import type { Queryable } from "../db";

/**
 * Sipariş kaleminin teslimat durumu. Yalnızca KAYDEDİLMİŞ (taslak/iptal değil) teslimatlar sayılır.
 *   Bekleyen = sipariş − iptal edilen − kabul edilen.
 * Reddedilen ve yönetim incelemesinde bekleyen miktar kabul edilmiş sayılmaz (bekleyen içinde kalır).
 */
export const LINE_STATS = `left join lateral (
    select coalesce(sum(rl.qty_accepted), 0) as accepted, coalesce(sum(rl.qty_rejected), 0) as rejected,
           coalesce(sum(rl.qty_held), 0) as held, coalesce(sum(rl.qty_physical), 0) as physical
    from receipt_lines rl join receipts rc on rc.id = rl.receipt_id
    where rl.order_line_id = ol.id and rc.status = 'kaydedildi'
  ) st on true`;

export interface LineState {
  id: string;
  lineNo: number;
  label: string;
  qty: string;
  unitLabel: string;
  canceledQty: string;
  accepted: string;
  rejected: string;
  held: string;
  pending: string;
}

export async function lineStates(q: Queryable, orderId: string): Promise<LineState[]> {
  return q.query<LineState>(
    `select ol.id, ol.line_no as "lineNo", concat_ws(' – ', p.name, nullif(concat_ws(' · ', v.brand, v.model, v.attributes), '')) as label,
       ol.qty, ol.unit_label as "unitLabel", ol.canceled_qty as "canceledQty", st.accepted, st.rejected, st.held,
       (ol.qty - ol.canceled_qty - st.accepted) as pending
     from order_lines ol join variants v on v.id = ol.variant_id join products p on p.id = v.product_id ${LINE_STATS}
     where ol.order_id = $1 order by ol.line_no`,
    [orderId],
  );
}

/** Normal "tamamlandı" kapanışını engelleyen durumlar (boş liste = kapatılabilir). */
export async function closeBlockers(q: Queryable, orderId: string): Promise<string[]> {
  const out: string[] = [];
  const lines = await lineStates(q, orderId);
  const pending = lines.filter((l) => isPositive(l.pending));
  if (pending.length) {
    out.push(`Teslim alınmamış miktar var: ${pending.map((l) => `${l.lineNo}. kalem ${formatQty(l.pending)} ${l.unitLabel}`).join(", ")}. Gelmeyecekse “Kalan miktarı iptal et” ile gerekçe girin.`);
  }
  const held = lines.filter((l) => isPositive(l.held));
  if (held.length) out.push(`Yönetim incelemesinde bekleyen ürün var (${held.map((l) => `${l.lineNo}. kalem`).join(", ")}).`);
  const [{ n }] = (await q.query<{ n: number }>(`select count(*) as n from delivery_issues where order_id = $1 and status = 'acik'`, [orderId])) as [{ n: number }];
  if (n > 0) out.push(`Çözülmemiş ${n} teslimat sorunu var.`);
  const [{ d }] = (await q.query<{ d: number }>(`select count(*) as d from receipts where order_id = $1 and status = 'taslak'`, [orderId])) as [{ d: number }];
  if (d > 0) out.push("Devam eden (kaydedilmemiş) bir teslimat kontrolü var.");
  return out;
}

/** Bekleyen miktarı kalmayan kalemlerdeki açık "eksik teslimat" sorunları otomatik çözülür (sonraki teslimat tamamladı). */
export async function autoResolveShortages(q: Queryable, ctx: Ctx, orderId: string): Promise<void> {
  const lines = await lineStates(q, orderId);
  const done = lines.filter((l) => !isPositive(l.pending)).map((l) => l.id);
  if (!done.length) return;
  const rows = await q.query<{ id: string; issue_no: string }>(
    `update delivery_issues set status = 'cozuldu', action = coalesce(action, 'eksik_bekleniyor'), resolved_by = $3, resolved_at = now(),
       resolution_note = coalesce(resolution_note, 'Eksik miktar sonraki teslimatla tamamlandı.'), version = version + 1, updated_at = now()
     where order_id = $1 and type = 'eksik' and status = 'acik' and order_line_id = any($2) returning id, issue_no`,
    [orderId, done, ctx.actor.userId],
  );
  for (const r of rows) {
    await audit(q, ctx, { entity: "issue", entityId: r.id, orderId, action: "auto_resolve", summary: `Sorun ${r.issue_no} otomatik çözüldü: eksik miktar teslim alındı` });
  }
}

/** Siparişin teslimat durumu (sipariş durumundan ayrı). */
export function deliveryState(status: string, lines: Pick<LineState, "accepted" | "pending">[]): "bekleniyor" | "kismi" | "tamam" | "yok" {
  if (status === "taslak" || status === "iptal" || !lines.length) return "yok";
  if (lines.every((l) => !isPositive(l.pending))) return "tamam";
  if (lines.some((l) => isPositive(l.accepted))) return "kismi";
  return "bekleniyor";
}
