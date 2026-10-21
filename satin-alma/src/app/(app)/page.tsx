import Link from "next/link";
import { BalanceTable, InvoiceTable, IssueList, OrderTable, RequestList } from "@/components/lists";
import { Card, EmptyState, Notice, PageHeader, StatTile } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { dashboard } from "@/server/services/dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx();
  const sp = await searchParams;
  const d = await dashboard(ctx);
  const more = (href: string) => <Link href={href} className="text-[15px] font-semibold text-brand hover:underline">Tümü →</Link>;
  return (
    <>
      <PageHeader
        title="Ana sayfa"
        subtitle={`Merhaba ${ctx.actor.displayName}`}
        actions={
          <>
            <Link href="/talepler/yeni" className="btn btn-primary">+ Malzeme talebi</Link>
            {can(ctx.actor, "order.manage") && <Link href="/siparisler/planla" className="btn btn-secondary">Sipariş planla</Link>}
          </>
        }
      />
      {firstParam(sp.yetki) === "yok" && (
        <div className="mb-4">
          <Notice tone="amber">Bu sayfaya erişim yetkiniz yok.</Notice>
        </div>
      )}

      {d.purchasing && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="Onay bekleyen talep" value={d.purchasing.pendingRequests.length} href="/talepler?gorunum=degerlendirme" tone={d.purchasing.pendingRequests.length ? "amber" : undefined} />
          <StatTile label="Acil talep" value={d.purchasing.urgentRequests.length} href="/siparisler/planla" tone={d.purchasing.urgentRequests.length ? "red" : undefined} />
          <StatTile label="Verilecek sipariş" value={d.purchasing.draftOrders.length} hint={`${d.purchasing.toOrder} talep siparişe eklenecek`} href="/siparisler?gorunum=taslak" />
          <StatTile label="Geciken teslimat" value={d.purchasing.overdueDeliveries.length} href="/siparisler?gorunum=geciken" tone={d.purchasing.overdueDeliveries.length ? "orange" : undefined} />
          <StatTile label="Çözülmemiş ürün sorunu" value={d.issues?.length ?? 0} href="/sorunlar" tone={d.issues?.length ? "red" : undefined} />
        </div>
      )}

      {d.finance && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Vadesi geçmiş fatura" value={d.finance.overdue.length} href="/finans/faturalar?gorunum=gecikti" tone={d.finance.overdue.length ? "red" : undefined} />
          <StatTile label="7 gün içinde vadesi gelen" value={d.finance.dueSoon.length} href="/finans/faturalar?gorunum=yaklasiyor" tone={d.finance.dueSoon.length ? "amber" : undefined} />
          <StatTile label="Fark incelemesi bekleyen fatura" value={d.finance.toReview.length} href="/finans/faturalar?gorunum=inceleme" tone={d.finance.toReview.length ? "orange" : undefined} />
          <StatTile label="Onay bekleyen düzeltme" value={d.finance.pendingAdjustments} href="/finans/duzeltmeler" />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {d.deliveries && (
          <Card title={`Teslimatı beklenen siparişler (${d.deliveries.length})`} actions={more("/teslimatlar")}>
            {d.deliveries.length ? (
              <ul className="space-y-2">
                {d.deliveries.slice(0, 8).map((o) => (
                  <li key={o.orderId}>
                    <Link href={o.draftReceiptId ? `/teslimatlar/${o.draftReceiptId}` : `/siparisler/${o.orderId}`} className="card flex items-center justify-between gap-2 p-3 hover:border-brand">
                      <span>
                        <span className="block font-bold">{o.orderNo} · {o.supplierName}</span>
                        <span className="text-sm text-muted">Beklenen {formatDate(o.expectedOn)} · {o.pendingLines} kalem bekleniyor</span>
                      </span>
                      <span className="btn btn-primary btn-sm">{o.draftReceiptId ? "Kontrole devam" : "Teslim al"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Teslimatı beklenen sipariş yok.</EmptyState>
            )}
          </Card>
        )}
        {d.purchasing && (
          <Card title={`Değerlendirme bekleyen talepler (${d.purchasing.pendingRequests.length})`} actions={more("/siparisler/planla")}>
            <RequestList rows={d.purchasing.pendingRequests.slice(0, 6)} empty="Bekleyen talep yok." />
          </Card>
        )}
        {d.purchasing && (
          <Card title={`Geciken teslimatlar (${d.purchasing.overdueDeliveries.length})`} actions={more("/siparisler?gorunum=geciken")}>
            <OrderTable rows={d.purchasing.overdueDeliveries.slice(0, 6)} empty="Geciken teslimat yok." />
          </Card>
        )}
        {d.purchasing && d.purchasing.receiptsInProgress.length > 0 && (
          <Card title={`Kontrol bekleyen teslimatlar (${d.purchasing.receiptsInProgress.length})`} actions={more("/siparisler?gorunum=kontrol")}>
            <OrderTable rows={d.purchasing.receiptsInProgress} />
          </Card>
        )}
        {d.issues && (
          <Card title={`Çözülmemiş ürün sorunları (${d.issues.length})`} actions={more("/sorunlar")}>
            <IssueList rows={d.issues.slice(0, 6)} />
          </Card>
        )}
        {d.finance && (
          <Card title="Tedarikçi bazında açık borç" className="lg:col-span-2" actions={more("/finans")}>
            <BalanceTable rows={d.finance.balances} />
            <p className="mt-2 text-sm text-muted">Para birimleri birbiriyle toplanmaz. Açık satın alma taahhüdü borç değildir (henüz faturalanmamış verilen siparişler).</p>
          </Card>
        )}
        {d.finance && (d.finance.overdue.length > 0 || d.finance.dueSoon.length > 0) && (
          <Card title="Vadesi geçmiş ve yaklaşan faturalar" className="lg:col-span-2">
            <InvoiceTable rows={[...d.finance.overdue, ...d.finance.dueSoon]} />
          </Card>
        )}
        <Card title="Son taleplerim" actions={more("/talepler")}>
          <RequestList rows={d.myRequests} showRequester={false} empty="Henüz talebiniz yok." />
        </Card>
      </div>
    </>
  );
}
