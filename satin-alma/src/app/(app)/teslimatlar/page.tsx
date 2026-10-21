import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { pageCtx } from "@/server/page";
import { myDeliveries } from "@/server/services/receipts";

export const dynamic = "force-dynamic";

/** Teslimat sorumlusunun iş listesi: kendisine atanan ve teslimatı beklenen siparişler. */
export default async function DeliveriesPage() {
  const ctx = await pageCtx("receipt.record");
  const rows = await myDeliveries(ctx);
  return (
    <>
      <PageHeader title="Teslimatlarım" subtitle="Size atanan, teslimatı beklenen siparişler. Ürün gelince açın ve kalem kalem kontrol edin." />
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((o) => (
            <li key={o.orderId}>
              <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link href={`/siparisler/${o.orderId}`} className="text-lg font-bold text-brand underline">{o.orderNo}</Link>
                  <div className="text-[15px]">{o.supplierName}</div>
                  <div className={`text-sm ${o.expectedOn && o.expectedOn < ctx.today ? "font-semibold text-orange-700" : "text-muted"}`}>
                    Beklenen {formatDate(o.expectedOn)}{o.expectedOn && o.expectedOn < ctx.today ? " (gecikti)" : ""} · {o.pendingLines} kalem bekleniyor
                  </div>
                </div>
                <Link className="btn btn-primary" href={o.draftReceiptId ? `/teslimatlar/${o.draftReceiptId}` : `/siparisler/${o.orderId}`}>
                  {o.draftReceiptId ? "Kontrole devam" : "Siparişi aç"}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Teslimatı beklenen sipariş yok.</EmptyState>
      )}
    </>
  );
}
