import { expect, test } from "@playwright/test";
import { isoDays, newSession } from "./helpers";

/**
 * Uçtan uca akış (telefon boyutu 390×844): talep → yönetim onayı/sipariş → kontrollü teslimat → fatura → ödeme → rapor.
 * Kabul senaryoları 1, 2, 5, 6 ve 10'un arayüz hâli.
 */
test("talep → sipariş → kontrollü teslimat → fatura → kısmi ödeme → rapor", async ({ browser }) => {
  test.setTimeout(240_000);

  // 1) Asistan telefondan 10 kutu talep eder
  const as = await newSession(browser, "Demo Asistan");
  await as.page.goto("/talepler/yeni");
  await as.page.getByLabel("Ürün", { exact: true }).fill("sterilizasyon poşeti");
  await as.page.getByRole("button", { name: /Sterilizasyon poşeti – Örnek Steril/ }).click();
  await as.page.getByText("Bitti", { exact: true }).click();
  await as.page.getByLabel("İstenen miktar").fill("10");
  await as.page.getByRole("button", { name: "Talebi gönder" }).click();
  await expect(as.page.getByText("Talebiniz gönderildi.")).toBeVisible();
  const requestNo = (await as.page.getByRole("heading", { level: 1 }).textContent())!.replace("Talep ", "").trim();
  await expect(as.page.getByText("Değerlendirme bekliyor").first()).toBeVisible();
  // Asistan finans menüsünü görmez
  await expect(as.page.getByRole("link", { name: "Finans" })).toHaveCount(0);

  // 2) Satın alma talebi planlar, tedarikçi ve fiyatı seçip siparişe ekler, siparişi verir
  const sa = await newSession(browser, "Demo Satın Alma");
  await sa.page.goto("/siparisler/planla");
  const group = sa.page.locator("section", { has: sa.page.getByRole("heading", { name: /Sterilizasyon poşeti/ }) });
  await expect(group.getByText(requestNo)).toBeVisible();
  await expect(group.getByLabel("Tedarikçi")).toHaveValue(/.+/); // tercih edilen tedarikçi önce gelir, ama seçimi kullanıcı yapar
  await group.getByLabel(/Birim fiyat/).fill("450");
  await group.getByRole("button", { name: "Sipariş taslağına ekle" }).click();
  await group.getByRole("link", { name: "Siparişi aç →" }).click();
  await expect(sa.page.getByText("Taslak (verilmedi)").first()).toBeVisible();
  const orderUrl = sa.page.url();
  await sa.page.getByRole("button", { name: "Sipariş metnini göster" }).click();
  await expect(sa.page.getByLabel("Sipariş metni")).toHaveValue(/10 kutu \[1 kutu = 200 adet\]/);
  await sa.page.getByRole("button", { name: "Sipariş verildi olarak işaretle" }).click();
  await sa.page.getByLabel("Sipariş kanalı").selectOption("whatsapp");
  await sa.page.getByLabel("Beklenen teslim tarihi").fill(isoDays(2));
  await sa.page.getByLabel("Teslim alacak sorumlu").selectOption({ label: "Demo Teslimat (Teslimat sorumlusu)" });
  await sa.page.locator("form").getByRole("button", { name: "Sipariş verildi olarak işaretle" }).click();
  await expect(sa.page.getByText("Sipariş verildi", { exact: true }).first()).toBeVisible();
  await expect(sa.page.getByText(/Demo Satın Alma · WhatsApp/)).toBeVisible();

  // 3) Teslimat: 6 kutu gelir; 5'i doğru (kabul), 1'i yanlış ölçü (ret)
  const ts = await newSession(browser, "Demo Teslimat");
  await ts.page.goto(orderUrl);
  await expect(ts.page.getByText("Birim fiyat (KDV hariç)")).toHaveCount(0); // teslimat sorumlusu fiyat görmez
  await ts.page.getByRole("button", { name: "Ürün geldi – teslimatı kontrol et" }).click();
  await ts.page.waitForURL(/\/teslimatlar\//);
  await ts.page.getByLabel(/Gelen miktar/).first().fill("5");
  await expect(ts.page.getByText("✓ Kontroller uygun: kabul edilebilir.")).toBeVisible();
  await ts.page.getByRole("button", { name: "+ Bu üründen başka lot / SKT ile gelen" }).click();
  await ts.page.getByLabel(/Gelen miktar/).nth(1).fill("1");
  await ts.page.getByRole("radiogroup", { name: "Doğru marka / tip / ölçü mü?" }).nth(1).getByRole("radio", { name: "Hayır" }).click();
  await ts.page.getByLabel("Ret (iade/değişim)").nth(1).fill("1");
  await ts.page.getByLabel("Yönetim incelemesi").nth(1).fill("0");
  await ts.page.getByLabel("Sorun açıklaması").fill("90×230 yerine 75×200 mm geldi");
  await expect(ts.page.getByText(/4 kutu eksik/)).toBeVisible();
  ts.page.on("dialog", (d) => d.accept());
  await ts.page.getByRole("button", { name: "Kontrolü tamamla ve kaydet" }).click();
  await expect(ts.page.getByText("Kaydedildi", { exact: true })).toBeVisible();
  await expect(ts.page.getByText(/Eksik teslimat/)).toBeVisible();
  await expect(ts.page.getByText(/Yanlış ürün veya varyant/)).toBeVisible();

  // Sipariş kendiliğinden tamamlanmadı; 5 kutu bekleniyor, kapanış engelli
  await sa.page.reload();
  await expect(sa.page.getByText("Kısmi teslim").first()).toBeVisible();
  await expect(sa.page.getByText("Sipariş henüz kapatılamaz")).toBeVisible();
  await expect(sa.page.getByRole("row", { name: /Sterilizasyon poşeti/ })).toContainText("5");

  // 4) Finans: farklı fiyatlı fatura → uyarı; kısmi ödeme → kalan borç azalır
  const fi = await newSession(browser, "Demo Finans");
  await fi.page.goto("/finans/faturalar/yeni");
  await fi.page.getByLabel("Tedarikçi").selectOption({ label: "Örnek Dental Depo A.Ş." });
  // Bu tedarikçinin teslim alınıp faturalanmamış başka kalemleri öneri olarak işaretli gelebilir; yalnızca bu siparişi faturalıyoruz.
  const line = fi.page.locator("li", { hasText: /Sterilizasyon poşeti/ });
  await expect(line.getByRole("checkbox")).toBeChecked();
  for (const other of await fi.page.locator("li", { hasNotText: /Sterilizasyon poşeti/ }).getByRole("checkbox", { checked: true }).all()) await other.uncheck();
  await expect(line.getByLabel(/Miktar/)).toHaveValue("5");
  await line.getByLabel("Birim fiyat (KDV hariç)").fill("460");
  await expect(line.getByText(/Fiyat siparişten farklı/)).toBeVisible();
  await fi.page.getByLabel("Fatura numarası").fill("E2E-2026-0001");
  await fi.page.getByRole("button", { name: "Faturayı kaydet" }).click();
  await expect(fi.page.getByText("Fatura kaydedildi.")).toBeVisible();
  await expect(fi.page.getByText(/Sipariş \/ teslimat ile 1 fark/)).toBeVisible();
  await expect(fi.page.getByText("2.760,00 TL").first()).toBeVisible();
  const invoiceUrl = fi.page.url();
  await fi.page.getByRole("link", { name: "+ Ödeme gir" }).click();
  await fi.page.getByLabel("Tutar").fill("1000");
  await fi.page.locator("div", { hasText: /^E2E-2026-0001/ }).getByLabel("Dağıtılan").fill("1000");
  await fi.page.getByRole("button", { name: "Ödemeyi kaydet" }).click();
  await expect(fi.page.getByText("Ödeme kaydedildi.")).toBeVisible();
  await fi.page.goto(invoiceUrl);
  await expect(fi.page.getByText("1.760,00 TL").first()).toBeVisible();

  // 5) Rapor: sipariş, satın alma ve ödeme ayrı sütunlarda
  await fi.page.goto("/raporlar");
  await expect(fi.page.getByText("1) Verilen sipariş (KDV hariç)")).toBeVisible();
  await expect(fi.page.getByText("2) Net satın alma (KDV hariç)")).toBeVisible();
  await expect(fi.page.getByText("3) Nakit çıkışı").first()).toBeVisible();

  for (const s of [as, sa, ts, fi]) await s.context.close();
});

test("aynı ürün için açık talep varken uyarı; gerekçeyle ek talep açılır", async ({ browser }) => {
  const as = await newSession(browser, "Demo Asistan");
  await as.page.goto("/talepler/yeni");
  await as.page.getByLabel("Ürün", { exact: true }).fill("nitril m beden");
  await as.page.getByRole("button", { name: /Nitril muayene eldiveni – Örnek Marka · Pudrasız · M beden/ }).click();
  await expect(as.page.getByText("Bu ürün için zaten açık talep veya beklenen sipariş var")).toBeVisible();
  await as.page.getByText("Azaldı", { exact: true }).click();
  await as.page.getByLabel("İstenen miktar").fill("2");
  await as.page.getByLabel("Ek ihtiyaç gerekçesi").fill("Cerrahi oda için ayrıca gerekli");
  await as.page.getByRole("button", { name: "Talebi gönder" }).click();
  await expect(as.page.getByText("Talebiniz gönderildi.")).toBeVisible();
  await expect(as.page.getByText("Cerrahi oda için ayrıca gerekli")).toBeVisible();
  await as.context.close();
});
