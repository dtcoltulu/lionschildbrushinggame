import { addDays, todayIstanbul } from "@/lib/dates";
import type { Role } from "@/lib/labels";
import type { Actor, Ctx } from "./context";
import { forClinic, type Db } from "./db";
import { createVariant } from "./services/catalog";
import { createInvoice } from "./services/invoices";
import { getOrder, placeOrder, planToOrder } from "./services/orders";
import { createPayment } from "./services/payments";
import { getReceipt, saveReceipt, startReceipt } from "./services/receipts";
import { createRequest } from "./services/requests";
import { createSupplier } from "./services/suppliers";

export const FIRST_CLINIC_ID = "00000000-0000-4000-8000-000000000001";

/**
 * YALNIZCA geliştirme/önizleme veritabanı için örnek veri. Bütün adlar "Örnek"/"Demo" ile başlar, klinik kaydı
 * `is_demo` olarak işaretlenir ve ekranda kırmızı "örnek veriler" şeridi görünür: gerçek veri gibi sunulmaz.
 * SEED_DEMO=users → yalnızca deneme hesapları; SEED_DEMO=0 → hiçbir şey.
 */
export const DEMO_USERS: { email: string; name: string; roles: Role[] }[] = [
  { email: "demo-asistan@ornek.local", name: "Demo Asistan", roles: ["asistan"] },
  { email: "demo-satinalma@ornek.local", name: "Demo Satın Alma", roles: ["satinalma"] },
  { email: "demo-teslimat@ornek.local", name: "Demo Teslimat", roles: ["teslimat"] },
  { email: "demo-finans@ornek.local", name: "Demo Finans", roles: ["finans"] },
  { email: "demo-yonetici@ornek.local", name: "Demo Klinik Yöneticisi", roles: ["satinalma", "finans"] },
];

export async function seedDemoIfEmpty(db: Db): Promise<void> {
  const scoped = forClinic(db, FIRST_CLINIC_ID);
  const [{ n }] = (await scoped.query<{ n: number }>(`select count(*) as n from app_users`)) as [{ n: number }];
  if (n > 0) return;
  await db.query(`update clinics set is_demo = true where id = $1`, [FIRST_CLINIC_ID]);
  const ids: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const [row] = await scoped.query<{ id: string }>(`insert into app_users (email, email_key, display_name, roles) values ($1, $1, $2, $3) returning id`, [u.email, u.name, u.roles]);
    ids[u.name] = row!.id;
  }
  if (process.env.SEED_DEMO === "users") return;

  const today = todayIstanbul();
  const ctx = (name: string): Ctx => {
    const u = DEMO_USERS.find((x) => x.name === name)!;
    const actor: Actor = { userId: ids[name]!, displayName: name, email: u.email, roles: u.roles, clinicId: FIRST_CLINIC_ID, clinicName: "Koşuyolu Park" };
    return { db: scoped, actor, today };
  };
  const sa = ctx("Demo Satın Alma");
  const fin = ctx("Demo Finans");
  const as = ctx("Demo Asistan");
  const ts = ctx("Demo Teslimat");
  const cat = new Map((await scoped.query<{ id: string; name: string }>(`select id, name from categories`)).map((c) => [c.name, c.id]));
  const loc = new Map((await scoped.query<{ id: string; name: string }>(`select id, name from locations`)).map((c) => [c.name, c.id]));

  const depoA = (await createSupplier(sa, { name: "Örnek Dental Depo A.Ş.", contactName: "Örnek Temsilci", phone: "0000 000 00 00", currency: "TRY", dueDays: 30, paymentTerms: "Fatura tarihinden 30 gün" })).id;
  const depoB = (await createSupplier(sa, { name: "Örnek Medikal Ltd.", currency: "TRY", dueDays: 15 })).id;

  const v = async (body: Record<string, unknown>) => (await createVariant(sa, body)).id;
  const gloveM = await v({ productName: "Nitril muayene eldiveni", categoryId: cat.get("Eldiven ve koruyucular"), brand: "Örnek Marka", model: "Pudrasız", attributes: "M beden", orderUnit: "kutu", baseUnit: "adet", packSize: "100", defaultVatRate: "10", suppliers: [{ supplierId: depoA }, { supplierId: depoB, preference: 2 }] });
  await v({ productName: "Nitril muayene eldiveni", categoryId: cat.get("Eldiven ve koruyucular"), brand: "Örnek Marka", model: "Pudrasız", attributes: "S beden", orderUnit: "kutu", baseUnit: "adet", packSize: "100", defaultVatRate: "10", suppliers: [{ supplierId: depoA }] });
  const gloveL = await v({ productName: "Nitril muayene eldiveni", categoryId: cat.get("Eldiven ve koruyucular"), brand: "Örnek Marka", model: "Pudrasız", attributes: "L beden", orderUnit: "kutu", baseUnit: "adet", packSize: "100", defaultVatRate: "10", suppliers: [{ supplierId: depoA }] });
  const composite = await v({ productName: "Kompozit dolgu maddesi", categoryId: cat.get("Restoratif"), brand: "Örnek Kompozit", attributes: "A2 · 4 g şırınga", orderUnit: "adet", baseUnit: "adet", packSize: "1", trackExpiry: true, trackLot: true, minShelfLifeDays: 180, defaultVatRate: "20", suppliers: [{ supplierId: depoB }] });
  await v({ productName: "Kanal eğesi (K tipi)", categoryId: cat.get("Endodonti"), brand: "Örnek Endo", attributes: "25 mm · No 15", orderUnit: "paket", baseUnit: "adet", packSize: "6", defaultVatRate: "20", suppliers: [{ supplierId: depoB }] });
  await v({ productName: "Aljinat ölçü maddesi", categoryId: cat.get("Ölçü"), brand: "Örnek Ölçü", attributes: "453 g", orderUnit: "paket", baseUnit: "gr", packSize: "453", trackExpiry: true, defaultVatRate: "20" });
  await v({ productName: "Sterilizasyon poşeti", categoryId: cat.get("Sterilizasyon"), brand: "Örnek Steril", attributes: "90 × 230 mm", orderUnit: "kutu", baseUnit: "adet", packSize: "200", defaultVatRate: "20", suppliers: [{ supplierId: depoA }] });
  await v({ productName: "Tükürük emici", categoryId: cat.get("Tek kullanımlık ürünler"), brand: "Örnek", orderUnit: "paket", baseUnit: "adet", packSize: "100", defaultVatRate: "20", suppliers: [{ supplierId: depoA }] });

  // Talepler
  const r1 = await createRequest(as, { variantId: gloveM, qty: "10", unitKind: "siparis", stockState: "bitti", urgency: "acil", locationId: loc.get("Ünit 1"), note: "Örnek: M beden bitti" });
  await createRequest(as, { variantId: composite, qty: "4", unitKind: "siparis", stockState: "azaldi", urgency: "normal", locationId: loc.get("Ünit 2"), remainingQty: "1" });
  await createRequest(as, { tempProductText: "Örnek: mavi renkli cerrahi bone", qty: "1", unitLabel: "paket", stockState: "azaldi", locationId: loc.get("Cerrahi oda") });

  // Verilmiş ve kısmen teslim alınmış sipariş (5 doğru + 1 yanlış beden)
  const { orderId } = await planToOrder(sa, { supplierId: depoA, variantId: gloveM, qty: "10", unitPrice: "250", vatRate: "10", allocations: [{ requestId: r1.id, qtyBase: "1000" }] });
  let o = await getOrder(sa, orderId);
  await placeOrder(sa, orderId, { version: o.version, channel: "whatsapp", expectedOn: addDays(today, 2), receiverUserId: ids["Demo Teslimat"] });
  o = await getOrder(sa, orderId);
  const { id: rid } = await startReceipt(ts, orderId);
  const rc = await getReceipt(ts, rid);
  await saveReceipt(ts, rid, {
    version: rc.version, deliveryNoteNo: "ORNEK-IRS-1",
    lines: [
      { orderLineId: o.lines[0]!.id, qtyPhysical: "5", qtyAccepted: "5" },
      { orderLineId: o.lines[0]!.id, receivedVariantId: gloveL, chkVariant: false, qtyPhysical: "1", qtyRejected: "1", issueType: "yanlis_urun", issueNote: "Örnek: M yerine L beden geldi" },
    ],
  }, true);

  // Fatura (siparişten farklı fiyat → inceleme) ve kısmi ödeme
  const inv = await createInvoice(fin, {
    supplierId: depoA, invoiceNo: "ORNEK-2026-0001", invoiceDate: today, lines: [{ orderLineId: o.lines[0]!.id, qty: "5", unitPrice: "255", vatRate: "10" }],
  });
  await createPayment(fin, { supplierId: depoA, paidOn: today, amount: "500", currency: "TRY", method: "havale_eft", reference: "ORNEK-EFT", allocations: [{ invoiceId: inv.id, amount: "500" }] });

  // Taslak sipariş (verilecek)
  await planToOrder(sa, { supplierId: depoB, variantId: composite, qty: "4", unitPrice: "320", vatRate: "20" });
}
