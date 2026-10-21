import "server-only";
import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/validate";
import type { Ctx } from "./context";
import { NotFoundError, ValidationError } from "./errors";
import { readJson } from "./http";
import { getLoginAdmin } from "./login-admin";
import { assertCan, can } from "./permissions";
import { dateParam } from "./page";
import * as adjustments from "./services/adjustments";
import * as balances from "./services/balances";
import * as catalog from "./services/catalog";
import { dashboard } from "./services/dashboard";
import { exportCsv } from "./services/export";
import * as files from "./services/files";
import * as invoices from "./services/invoices";
import * as issues from "./services/issues";
import * as lookups from "./services/lookups";
import * as orders from "./services/orders";
import * as payments from "./services/payments";
import * as receipts from "./services/receipts";
import { defaultPeriod, monthlyReport, spendReport, type SpendGroup } from "./services/reports";
import * as requests from "./services/requests";
import * as suppliers from "./services/suppliers";
import * as users from "./services/users";

/**
 * Bütün JSON uç noktaları tek tabloda: "YÖNTEM yol". `:ad` parçaları parametredir (`:id` biçimli olanlar UUID olmalıdır).
 * Yetki kontrolü burada değil, çağrılan servis fonksiyonunun içindedir (assertCan): ekran veya bağlantı fark etmez.
 */
type Handler = (ctx: Ctx, req: NextRequest, p: Record<string, string>) => Promise<unknown>;

const body = (req: NextRequest) => readJson(req);
const sp = (req: NextRequest, k: string) => req.nextUrl.searchParams.get(k) ?? undefined;
const period = (ctx: Ctx, req: NextRequest) => {
  const d = defaultPeriod(ctx.today);
  const from = dateParam(sp(req, "from")) ?? d.from;
  const to = dateParam(sp(req, "to")) ?? d.to;
  if (from > to) throw new ValidationError({ from: "Başlangıç tarihi bitişten sonra olamaz." });
  return { from, to };
};

const ROUTES: [string, Handler][] = [
  ["GET panel", (ctx) => dashboard(ctx)],

  // Katalog
  ["GET katalog/ara", async (ctx, req) => {
    assertCan(ctx.actor, "catalog.view");
    return { items: await catalog.searchVariants(ctx.db, sp(req, "q") ?? "", { limit: 25, includeInactive: sp(req, "pasif") === "1" && can(ctx.actor, "catalog.manage") }) };
  }],
  ["POST katalog", async (ctx, req) => ({ variant: await catalog.createVariant(ctx, await body(req)) })],
  ["PATCH katalog/:id", async (ctx, req, p) => ({ variant: await catalog.updateVariant(ctx, p.id!, await body(req)) })],
  ["GET katalog/:id/fiyatlar", async (ctx, _req, p) => ({ history: await catalog.priceHistory(ctx, p.id!) })],
  ["POST teklifler", async (ctx, req) => catalog.createQuote(ctx, await body(req))],
  ["DELETE teklifler/:id", async (ctx, _req, p) => catalog.cancelQuote(ctx, p.id!)],

  // Tedarikçiler
  ["POST tedarikciler", async (ctx, req) => ({ supplier: await suppliers.createSupplier(ctx, await body(req)) })],
  ["PATCH tedarikciler/:id", async (ctx, req, p) => ({ supplier: await suppliers.updateSupplier(ctx, p.id!, await body(req)) })],

  // Talepler
  ["GET talepler", async (ctx, req) => ({ items: await requests.listRequests(ctx, { view: (sp(req, "gorunum") as requests.RequestFilters["view"]) ?? "acik", q: sp(req, "q") }) })],
  ["POST talepler", async (ctx, req) => ({ request: await requests.createRequest(ctx, await body(req)) })],
  ["GET talepler/acik-ihtiyac", async (ctx, req) => {
    assertCan(ctx.actor, "catalog.view");
    const id = sp(req, "variantId");
    if (!isUuid(id)) throw new ValidationError({ variantId: "Ürün seçin." });
    return requests.openNeeds(ctx.db, id, { showSupplier: can(ctx.actor, "order.view") });
  }],
  ["GET talepler/:id", async (ctx, _req, p) => ({ request: await requests.getRequest(ctx, p.id!) })],
  ["POST talepler/:id/karar", async (ctx, req, p) => ({ request: await requests.decideRequest(ctx, p.id!, await body(req)) })],
  ["POST talepler/:id/iptal", async (ctx, req, p) => ({ request: await requests.cancelRequest(ctx, p.id!, await body(req)) })],
  ["POST talepler/:id/eslestir", async (ctx, req, p) => ({ request: await requests.matchRequest(ctx, p.id!, await body(req)) })],

  // Siparişler
  ["GET siparisler", async (ctx, req) => ({ items: await orders.listOrders(ctx, { view: sp(req, "gorunum") as orders.OrderFilters["view"], q: sp(req, "q") }) })],
  ["POST siparisler", async (ctx, req) => orders.createOrder(ctx, await body(req))],
  ["POST siparisler/planla", async (ctx, req) => orders.planToOrder(ctx, await body(req))],
  ["GET siparisler/:id", async (ctx, _req, p) => ({ order: await orders.getOrder(ctx, p.id!) })],
  ["PATCH siparisler/:id", async (ctx, req, p) => ({ order: await orders.updateOrder(ctx, p.id!, await body(req)) })],
  ["POST siparisler/:id/kalemler", async (ctx, req, p) => orders.addLine(ctx, p.id!, await body(req))],
  ["POST siparisler/:id/ver", async (ctx, req, p) => ({ order: await orders.placeOrder(ctx, p.id!, await body(req)) })],
  ["POST siparisler/:id/iptal", async (ctx, req, p) => ({ order: await orders.cancelOrder(ctx, p.id!, await body(req)) })],
  ["POST siparisler/:id/kalan-iptal", async (ctx, req, p) => orders.cancelRemaining(ctx, p.id!, await body(req))],
  ["POST siparisler/:id/kapat", async (ctx, req, p) => ({ order: await orders.closeOrder(ctx, p.id!, await body(req)) })],
  ["GET siparisler/:id/metin", async (ctx, req, p) => ({ text: await orders.orderMessage(ctx, p.id!, sp(req, "fiyat") === "1") })],
  ["POST siparisler/:id/teslimat", async (ctx, _req, p) => receipts.startReceipt(ctx, p.id!)],
  ["PATCH siparis-kalemleri/:id", async (ctx, req, p) => ({ order: await orders.updateLine(ctx, p.id!, await body(req)) })],
  ["DELETE siparis-kalemleri/:id", async (ctx, _req, p) => orders.removeLine(ctx, p.id!)],
  ["POST talep-baglantisi", async (ctx, req) => orders.linkRequest(ctx, await body(req))],
  ["POST talep-baglantisi/kaldir", async (ctx, req) => orders.unlinkRequest(ctx, await body(req))],

  // Teslimat kontrolü ve sorunlar
  ["GET teslimatlar/:id", async (ctx, _req, p) => ({ receipt: await receipts.getReceipt(ctx, p.id!) })],
  ["PUT teslimatlar/:id", async (ctx, req, p) => ({ receipt: await receipts.saveReceipt(ctx, p.id!, await body(req), false) })],
  ["POST teslimatlar/:id/tamamla", async (ctx, req, p) => ({ receipt: await receipts.saveReceipt(ctx, p.id!, await body(req), true) })],
  ["POST teslimatlar/:id/iptal", async (ctx, req, p) => ({ receipt: await receipts.cancelReceipt(ctx, p.id!, await body(req)) })],
  ["GET sorunlar", async (ctx, req) => ({ items: await issues.listIssues(ctx, { status: (sp(req, "durum") as "acik" | "cozuldu" | "tumu") ?? "acik" }) })],
  ["GET sorunlar/:id", async (ctx, _req, p) => ({ issue: await issues.getIssue(ctx, p.id!) })],
  ["PATCH sorunlar/:id", async (ctx, req, p) => ({ issue: await issues.updateIssue(ctx, p.id!, await body(req)) })],
  ["POST sorunlar/:id/coz", async (ctx, req, p) => ({ issue: await issues.resolveIssue(ctx, p.id!, await body(req)) })],

  // Finans
  ["GET faturalar", async (ctx, req) => ({ items: await invoices.listInvoices(ctx, { view: sp(req, "gorunum") as invoices.InvoiceFilters["view"] }) })],
  ["POST faturalar", async (ctx, req) => invoices.createInvoice(ctx, await body(req))],
  ["GET faturalar/kalemler/:id", async (ctx, _req, p) => invoices.invoiceableLines(ctx, p.id!)],
  ["GET faturalar/:id", async (ctx, _req, p) => ({ invoice: await invoices.getInvoice(ctx, p.id!) })],
  ["PATCH faturalar/:id", async (ctx, req, p) => invoices.updateInvoiceMeta(ctx, p.id!, await body(req))],
  ["POST faturalar/:id/inceleme", async (ctx, req, p) => invoices.reviewInvoice(ctx, p.id!, await body(req))],
  ["POST faturalar/:id/iptal", async (ctx, req, p) => invoices.cancelInvoice(ctx, p.id!, await body(req))],
  ["POST acilis-bakiyesi", async (ctx, req) => invoices.createOpeningBalance(ctx, await body(req))],
  ["GET odemeler", async (ctx) => ({ items: await payments.listPayments(ctx) })],
  ["POST odemeler", async (ctx, req) => payments.createPayment(ctx, await body(req))],
  ["GET odemeler/:id", async (ctx, _req, p) => ({ payment: await payments.getPayment(ctx, p.id!) })],
  ["POST odemeler/:id/dagit", async (ctx, req, p) => payments.allocatePayment(ctx, p.id!, await body(req))],
  ["POST odemeler/:id/iptal", async (ctx, req, p) => payments.cancelPayment(ctx, p.id!, await body(req))],
  ["POST dagitimlar/:id/kaldir", async (ctx, req, p) => payments.releaseAllocation(ctx, p.id!, await body(req))],
  ["GET duzeltmeler", async (ctx) => ({ items: await adjustments.listAdjustments(ctx) })],
  ["POST duzeltmeler", async (ctx, req) => adjustments.createAdjustment(ctx, await body(req))],
  ["POST duzeltmeler/:id/onayla", async (ctx, req, p) => adjustments.approveAdjustment(ctx, p.id!, await body(req))],
  ["POST duzeltmeler/:id/iptal", async (ctx, req, p) => adjustments.cancelAdjustment(ctx, p.id!, await body(req))],
  ["GET bakiyeler", async (ctx, req) => ({ items: await balances.supplierBalances(ctx, { supplierId: sp(req, "tedarikci") }) })],
  ["GET acik-faturalar/:id", async (ctx, _req, p) => ({ items: await balances.openInvoices(ctx, p.id!) })],
  ["GET raporlar/aylik", async (ctx, req) => ({ items: await monthlyReport(ctx, period(ctx, req)) })],
  ["GET raporlar/harcama", async (ctx, req) => ({ items: await spendReport(ctx, period(ctx, req), ((sp(req, "grup") ?? "urun") as SpendGroup)) })],
  ["GET disa-aktar/:kind", async (ctx, req, p) => {
    const { filename, body: csv } = await exportCsv(ctx, p.kind!, period(ctx, req));
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
  }],

  // Dosyalar
  ["GET dosyalar", async (ctx, req) => {
    const id = sp(req, "id");
    if (!isUuid(id)) throw new NotFoundError();
    return { items: await files.listFiles(ctx, sp(req, "tur") as files.FileEntity, id) };
  }],
  ["POST dosyalar", async (ctx, req) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const entity = String(form?.get("entity") ?? "");
    const entityId = String(form?.get("entityId") ?? "");
    if (!form || !(file instanceof Blob)) throw new ValidationError({ file: "Dosya seçin." });
    if (!isUuid(entityId)) throw new ValidationError({ entityId: "Kayıt bulunamadı." });
    const data = new Uint8Array(await file.arrayBuffer());
    return { file: await files.uploadFile(ctx, { entity, entityId, filename: (file as File).name ?? "dosya", data }) };
  }],
  ["GET dosyalar/:id", async (ctx, _req, p) => {
    const { meta, data } = await files.readFile(ctx, p.id!);
    const inline = meta.mime.startsWith("image/") || meta.mime === "application/pdf";
    return new Response(Buffer.from(data), {
      headers: {
        "content-type": meta.mime,
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }],
  ["DELETE dosyalar/:id", async (ctx, _req, p) => files.removeFile(ctx, p.id!)],

  // Kullanıcılar ve listeler
  ["GET kullanicilar", async (ctx) => ({ items: await users.listUsers(ctx) })],
  ["POST kullanicilar", async (ctx, req) => users.createUser(ctx, await body(req), getLoginAdmin())],
  ["PATCH kullanicilar/:id", async (ctx, req, p) => ({ user: await users.updateUser(ctx, p.id!, await body(req), getLoginAdmin()) })],
  ["POST kullanicilar/:id/parola", async (ctx, req, p) => users.resetPassword(ctx, p.id!, await body(req), getLoginAdmin())],
  ["POST listeler/:kind", async (ctx, req, p) => {
    if (!lookups.isLookupKind(p.kind!)) throw new NotFoundError();
    return { item: await lookups.createLookup(ctx, p.kind, await body(req)) };
  }],
  ["PATCH listeler/:kind/:id", async (ctx, req, p) => {
    if (!lookups.isLookupKind(p.kind!)) throw new NotFoundError();
    return { item: await lookups.updateLookup(ctx, p.kind, p.id!, await body(req)) };
  }],
];

const COMPILED = ROUTES.map(([key, handler]) => {
  const [method, path] = key.split(" ") as [string, string];
  return { method, parts: path.split("/"), handler };
});

/** Yolu tabloyla eşler. `:id` ile biten parametreler UUID değilse eşleşme 404 olur (veritabanına geçersiz kimlik gitmez). */
export function matchRoute(method: string, segments: string[]): { handler: Handler; params: Record<string, string> } | "method" | null {
  let pathMatched = false;
  for (const r of COMPILED) {
    if (r.parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const part = r.parts[i]!;
      const seg = segments[i]!;
      if (part.startsWith(":")) {
        if (part === ":id" && !isUuid(seg)) {
          ok = false;
          break;
        }
        params[part.slice(1)] = seg;
      } else if (part !== seg) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (r.method === method) return { handler: r.handler, params };
  }
  return pathMatched ? "method" : null;
}
