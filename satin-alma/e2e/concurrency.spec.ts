import { expect, test } from "@playwright/test";
import { api, demoUserId, expectOk, isoDays, newSession } from "./helpers";

/** Kabul 9 ve 7'nin HTTP hâli: eşzamanlı istekler. */
test("iki kullanıcı aynı teslimatı aynı anda kaydeder: miktar bir kez işlenir", async ({ browser }) => {
  const sa = await newSession(browser, "Demo Satın Alma");
  const ts = await newSession(browser, "Demo Teslimat");
  const search = await api<{ items: { id: string; label: string }[] }>(sa.page, "GET", `/api/katalog/ara?q=${encodeURIComponent("tükürük emici")}`);
  const variantId = search.body.items[0]!.id;
  const suppliers = await (await sa.page.request.get("/tedarikciler")).text();
  // Akış testinden ayrı tedarikçi: diğer testin faturalanacak kalemlerine karışmasın.
  const supplierId = /\/tedarikciler\/([0-9a-f-]{36})"[^>]*>Örnek Medikal/.exec(suppliers)![1];
  const plan = await api<{ orderId: string }>(sa.page, "POST", "/api/siparisler/planla", { supplierId, variantId, qty: "8", unitPrice: "30", vatRate: "20" });
  await expectOk(plan);
  const orderId = plan.body.orderId;
  // Tedarikçinin açık taslağı varsa kalem ona eklenir; bu yüzden kalem ürüne göre bulunur.
  type O = { order: { version: number; lines: { id: string; variantId: string }[] } };
  let order = (await api<O>(sa.page, "GET", `/api/siparisler/${orderId}`)).body.order;
  const receiverUserId = await demoUserId(browser, "Demo Teslimat");
  await expectOk(await api(sa.page, "POST", `/api/siparisler/${orderId}/ver`, { version: order.version, channel: "telefon", expectedOn: isoDays(1), receiverUserId }));

  // İkisi aynı anda "teslimatı başlat" der → tek kontrol kaydı
  const [a, b] = await Promise.all([api<{ id: string }>(ts.page, "POST", `/api/siparisler/${orderId}/teslimat`), api<{ id: string }>(sa.page, "POST", `/api/siparisler/${orderId}/teslimat`)]);
  await expectOk(a);
  await expectOk(b);
  expect(a.body.id).toBe(b.body.id);
  const receipt = (await api<{ receipt: { version: number } }>(ts.page, "GET", `/api/teslimatlar/${a.body.id}`)).body.receipt;
  order = (await api<O>(sa.page, "GET", `/api/siparisler/${orderId}`)).body.order;
  const lineId = order.lines.find((l) => l.variantId === variantId)!.id;
  const body = { version: receipt.version, lines: [{ orderLineId: lineId, qtyPhysical: "8", qtyAccepted: "8" }] };
  const results = await Promise.all([
    api(ts.page, "POST", `/api/teslimatlar/${a.body.id}/tamamla`, body),
    api(sa.page, "POST", `/api/teslimatlar/${a.body.id}/tamamla`, body),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const after = await api<{ order: { lines: { id: string; accepted: string }[]; receipts: { status: string }[] } }>(sa.page, "GET", `/api/siparisler/${orderId}`);
  expect(Number(after.body.order.lines.find((l) => l.id === lineId)!.accepted)).toBe(8);
  expect(after.body.order.receipts.filter((r) => r.status === "kaydedildi")).toHaveLength(1);
  await sa.context.close();
  await ts.context.close();
});

test("aynı fatura iki kez gönderilirse yalnızca biri kaydedilir", async ({ browser }) => {
  const fi = await newSession(browser, "Demo Finans");
  const html = await (await fi.page.request.get("/tedarikciler")).text();
  const supplierId = /\/tedarikciler\/([0-9a-f-]{36})/.exec(html)![1];
  const body = { supplierId, invoiceNo: "E2E-CIFT-1", invoiceDate: isoDays(0), lines: [{ description: "Kargo", qty: "1", unitPrice: "100", vatRate: "20" }] };
  const results = await Promise.all([api(fi.page, "POST", "/api/faturalar", body), api(fi.page, "POST", "/api/faturalar", body)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const again = await api<{ code: string }>(fi.page, "POST", "/api/faturalar", { ...body, invoiceNo: "e2e cift 1" });
  expect(again.status).toBe(409);
  expect(again.body.code).toBe("duplicate_invoice");
  await fi.context.close();
});
