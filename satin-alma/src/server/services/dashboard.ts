import { dec } from "@/lib/decimal";
import type { Ctx } from "../context";
import { can } from "../permissions";
import { openInvoices, supplierBalances, type SupplierBalance } from "./balances";
import { listInvoices, type InvoiceSummary } from "./invoices";
import { listIssues, type IssueRow } from "./issues";
import { listOrders, type OrderSummary } from "./orders";
import { myDeliveries } from "./receipts";
import { listRequests, planningQueue, type RequestRow } from "./requests";

/**
 * Ana ekran: kullanıcının rollerine göre bölümler. Finans bölümleri yalnızca finans rolüne hesaplanır ve gönderilir.
 */
export interface Dashboard {
  myRequests: RequestRow[];
  purchasing: null | {
    pendingRequests: RequestRow[];
    urgentRequests: RequestRow[];
    toMatch: number;
    toOrder: number;
    draftOrders: OrderSummary[];
    overdueDeliveries: OrderSummary[];
    receiptsInProgress: OrderSummary[];
  };
  issues: null | IssueRow[];
  deliveries: null | Awaited<ReturnType<typeof myDeliveries>>;
  finance: null | {
    balances: SupplierBalance[];
    overdue: InvoiceSummary[];
    dueSoon: InvoiceSummary[];
    toReview: InvoiceSummary[];
    pendingAdjustments: number;
  };
}

export async function dashboard(ctx: Ctx): Promise<Dashboard> {
  const out: Dashboard = { myRequests: [], purchasing: null, issues: null, deliveries: null, finance: null };
  out.myRequests = (await listRequests(ctx, { view: "benim" })).slice(0, 8);
  if (can(ctx.actor, "request.decide") && can(ctx.actor, "order.view")) {
    const [queue, orders] = await Promise.all([planningQueue(ctx), listOrders(ctx, {})]);
    const pending = queue.filter((r) => r.status === "beklemede");
    out.purchasing = {
      pendingRequests: pending,
      urgentRequests: queue.filter((r) => r.urgency !== "normal"),
      toMatch: queue.filter((r) => !r.variantId).length,
      toOrder: queue.filter((r) => r.variantId).length,
      draftOrders: orders.filter((o) => o.status === "taslak"),
      overdueDeliveries: orders.filter((o) => o.overdue),
      receiptsInProgress: orders.filter((o) => o.draftReceiptId),
    };
  }
  if (can(ctx.actor, "order.view") || can(ctx.actor, "issue.report")) out.issues = await listIssues(ctx, { status: "acik" });
  if (can(ctx.actor, "receipt.record")) out.deliveries = await myDeliveries(ctx);
  if (can(ctx.actor, "finance.view")) {
    const [balances, open, toReview] = await Promise.all([supplierBalances(ctx), openInvoices(ctx), listInvoices(ctx, { view: "inceleme" })]);
    const [{ n }] = (await ctx.db.query<{ n: number }>(`select count(*) as n from financial_adjustments where status = 'onay_bekliyor'`)) as [{ n: number }];
    out.finance = {
      balances: balances.filter((b) => !dec(b.balance).isZero() || !dec(b.commitment).isZero() || !dec(b.unallocated).isZero()),
      overdue: open.filter((i) => i.dueState === "gecikti"),
      dueSoon: open.filter((i) => i.dueState === "yaklasiyor"),
      toReview,
      pendingAdjustments: n,
    };
  }
  return out;
}
