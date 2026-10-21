# Satın Alma – Koşuyolu Park

Özel Koşuyolu Park Ağız ve Diş Sağlığı Polikliniği için **dental sarf malzemesi talep, satın alma, teslimat kontrolü ve tedarikçi
borç takibi** uygulaması. Amaç yalnızca sipariş listesi tutmak değil; yanlış ürün, eksik teslimat, farklı marka, son kullanma tarihi
geçmiş ürün ve kontrolsüz harcamayı önleyen, sorumlulukları belli bir satın alma süreci.

> Bu klasör depodaki Lions oyunundan ve `cihaz-takip/` (DENTINEL) uygulamasından **bağımsızdır**: kendi `package.json`'ı,
> veritabanı ve yayın ayarları vardır. Aynı teknoloji yığınını ve kalıpları (sunucu tarafı yetki, satır güvenliği, işlem geçmişi) kullanır.
>
> **Operasyonel takip aracıdır; resmî muhasebe sistemi veya e-fatura entegrasyonu değildir.** Hasta verisi toplanmaz.

- [1. Akış](#1-akış)
- [2. Roller ve yetkiler](#2-roller-ve-yetkiler)
- [3. Ekranlar](#3-ekranlar)
- [4. Kurallar nasıl uygulanıyor](#4-kurallar-nasıl-uygulanıyor)
- [5. Veri modeli](#5-veri-modeli)
- [6. Yerelde çalıştırma](#6-yerelde-çalıştırma)
- [7. Testler](#7-testler)
- [8. Kurulum (Supabase + Vercel)](#8-kurulum-supabase--vercel)
- [9. Yedekleme ve geri yükleme](#9-yedekleme-ve-geri-yükleme)
- [10. Güvenlik](#10-güvenlik)
- [11. Varsayımlar ve karar bekleyen konular](#11-varsayımlar-ve-karar-bekleyen-konular)
- [12. Bilinen sınırlamalar ve sonraki adımlar](#12-bilinen-sınırlamalar-ve-sonraki-adımlar)

---

## 1. Akış

```
Talep (asistan) → değerlendirme / birleştirme / bölme (satın alma) → sipariş taslağı → "verildi" (kanal + kişi + tarih)
  → teslimat kontrolü (kalem kalem: kabul / ret / yönetim incelemesi) → sorunlar (eksik, yanlış, farklı marka, SKT…)
  → fatura (sipariş ↔ teslimat ↔ fatura karşılaştırması) → ödeme (kısmi, faturalara dağıtım, avans) → raporlar
```

Durumlar **tek bir alana sıkıştırılmaz**; her biri ayrı tutulur ve birbirine bağlıdır:

| Kavram | Nerede | Değerler |
|---|---|---|
| Talep değerlendirmesi | `requests.status` | değerlendirme bekliyor / onaylandı / reddedildi / iptal |
| Talep ilerlemesi | hesaplanır (bağlantılar + kabul edilen teslimat) | eşleştirme bekliyor, siparişe eklenecek, sipariş hazırlanıyor, siparişte, kısmen teslim, teslim alındı |
| Sipariş | `purchase_orders.status` | taslak / verildi / kapandı / iptal |
| Teslimat | hesaplanır (kalem: sipariş − iptal − kabul) | bekleniyor / kısmi / tamamı teslim alındı |
| Teslimat kontrolü | `receipts.status` | kontrol sürüyor / kaydedildi / iptal (ters kayıt) |
| Uyuşmazlık | `delivery_issues.status` + `action` | açık / çözüldü; çözüm yolu ayrı |
| Fatura farkı | `invoices.review_status` | fark yok / inceleme bekliyor / kabul edildi / itiraz |
| Borç ve ödeme | hesaplanır (fatura − dağıtımlar ± onaylı düzeltmeler) | kalan, vadesi geçti / yaklaşıyor / ödendi |

## 2. Roller ve yetkiler

Bir kullanıcıya **birden fazla rol** verilebilir (ör. teslimat + finans). Yetkiler `src/server/permissions.ts` içinde tek tablodadır ve
**her servis fonksiyonunda sunucuda** denetlenir (`assertCan`); menü gizlemek yalnızca kolaylıktır.

| Rol | Yapabilir | Göremez |
|---|---|---|
| **Asistan** | Talep açar (açıklama, fotoğraf), **yalnızca kendi** taleplerini ve durumlarını görür, katalogda arar | Sipariş tutarı, fiyat, tedarikçi borcu, fatura, ödeme, raporlar |
| **Yönetim / satın alma** | Talepleri değerlendirir, birleştirir/böler, reddeder, onaylar; katalog ve tedarikçi; teklif; sipariş taslağı, "verildi", değişiklik (gerekçeli), kalan iptali, kapanış; teslimat sorunlarını çözer; teslimat kaydının ters kaydı | Fatura, ödeme, borç, finansal raporlar |
| **Teslimat sorumlusu** | **Atandığı** siparişleri görür (fiyatsız), teslimatı kalem kalem kontrol eder, sorun bildirir, "tedarikçiye geri verildi" tarihini girer | Fiyatlar, borç, ödeme (finans rolü ayrıca verilmedikçe) |
| **Finans / klinik yöneticisi** | Fatura, vade, borç, ödeme, avans, finansal düzeltme (onay), açılış borcu, harcama ve tedarikçi raporları, CSV; kullanıcı ve rol yönetimi | — |

Her işlem gerçek bir kullanıcıyla ilişkilendirilir: ortak/paylaşılan giriş yoktur; işlem geçmişinde kişi adı yazar.

## 3. Ekranlar

| Ekran | Adres | Kim |
|---|---|---|
| Ana sayfa: onay bekleyen ve acil talepler, verilecek siparişler, geciken ve kontrol bekleyen teslimatlar, çözülmemiş sorunlar, tedarikçi bazında açık borç, vadesi yaklaşan/geçmiş faturalar | `/` | rolüne göre |
| Hızlı talep (telefon): ürün ara → azaldı/bitti → miktar → gönder; isteğe bağlı kalan, tarih, oda, açıklama, fotoğraf | `/talepler/yeni` | herkes |
| Talepler (asistan: Taleplerim), talep ayrıntısı, onay/ret, katalog eşleştirme | `/talepler`, `/talepler/[id]` | herkes / satın alma |
| Sipariş planla: bekleyen talepleri ürün bazında birleştir/böl, tedarikçi ve fiyatı seç, fiyat geçmişi | `/siparisler/planla` | satın alma |
| Siparişler (açık, taslak, teslimat bekleyen, geciken, sorunlu…), sipariş ayrıntısı, kopyalanabilir sipariş metni | `/siparisler`, `/siparisler/[id]` | satın alma, finans (teslimat: atananlar) |
| Teslimatlarım ve **kalem bazlı teslimat kontrolü** | `/teslimatlar`, `/teslimatlar/[id]` | teslimat, satın alma |
| Teslimat sorunları ve çözüm | `/sorunlar`, `/sorunlar/[id]` | satın alma, teslimat (atananlar) |
| Katalog (arama, varyant, fiyat geçmişi, teklif) | `/katalog`, `/katalog/[id]` | herkes (fiyatlar: satın alma/finans) |
| Tedarikçi kartı ve geçmişi | `/tedarikciler/[id]` | satın alma, finans (borç bölümü: finans) |
| Finans: özet, faturalar, ödemeler, düzeltmeler | `/finans/*` | finans |
| Raporlar (aylık 3 rakam, ürün/kategori/tedarikçi, fiyat değişimi, KDV dahil/hariç, CSV) | `/raporlar` | finans |
| Ayarlar: kullanıcılar ve roller, oda/bölüm ve kategoriler, işlem geçmişi, dışa aktarım | `/ayarlar/*` | finans / satın alma |

Telefonda alt menünün ortasında büyük **"+ Talep"** düğmesi vardır. Fotoğraflar yüklenmeden önce cihazda küçültülür.

## 4. Kurallar nasıl uygulanıyor

| İstek | Uygulama |
|---|---|
| Aynı ürünün farklı yazımla tekrar açılmaması | Ürün adı Türkçe karakter/büyük harf/noktalama farkı olmadan karşılaştırılır; aynıysa mevcut ürünün altına varyant eklenir. Benzer ad ("eldivenleri" ≈ "eldiveni") için açık onay istenir. Aynı varyant (ürün + marka + tip + özellik + paket) ve aynı barkod veritabanında benzersizdir. |
| Farklı marka/ölçü/tip ayrı varyant; kutu ≠ adet | Her varyantın sipariş birimi, temel birimi ve paket içeriği vardır (1 kutu = 100 adet). Fiyatlar hem sipariş birimi hem temel birim başına, iskonto düşülmüş, **KDV hariç ve dahil ayrı** gösterilir. Kullanılan varyantın birimi değiştirilemez (geçmiş bozulmasın). |
| Katalog dışı ürün | Asistan serbest tanımla talep açar; yönetim mevcut ürünle eşleştirir veya talepten yeni ürün açar. Eşleşmeden siparişe bağlanamaz. |
| Mükerrer alımı önleme | Ürün seçilince aynı ürünün açık talepleri ve bekleyen siparişleri gösterilir. Varsa sunucu talebi reddeder (409); **gerekçe yazılırsa** açılır, gerekçe saklanır. Çift dokunma/yeniden gönderim aynı talebi döndürür (idempotency anahtarı). |
| Talep birleştirme / bölme | `request_allocations`: bir kalem birden fazla talebi karşılar; bir talep birden fazla kaleme/tedarikçiye bölünür. Bağlanan miktar ihtiyacı ve kalem kapasitesini aşamaz. Talebin teslim alınan miktarı kabul edilen teslimattan dağıtılarak hesaplanır. |
| Sistem en ucuzu seçmesin | Planlamada tercih edilen tedarikçi önce listelenir, son alış fiyatı öneri olarak yazılır; seçimi ve fiyatı kullanıcı yapar. |
| "Verildi" | Kullanıcı, zaman, kanal (telefon/WhatsApp/e-posta…), beklenen tarih ve teslim alacak kişi zorunlu. Mesaj gönderilmez; **kopyalanabilir sipariş metni** üretilir. Sonraki her değişiklik **gerekçeyle** ve eski → yeni değerleriyle geçmişe yazılır. |
| "Ürün geldi" siparişi tamamlamaz | Teslimat kontrolü ayrı kayıttır; sipariş ancak yönetim kapatınca kapanır. |
| Kalem bazlı kontrol | Doğru ürün? Doğru marka/tip/ölçü? Ambalaj sağlam? SKT? Lot? Fiziksel gelen = **kabul + ret + yönetim incelemesi** (veritabanı kısıtı). Sipariş, kabul, ret, incelemede, iptal ve bekleyen miktarlar ayrı. |
| SKT geçmiş ürün | Kabul edilemez, incelemeye de alınamaz (servis kuralı + `receipt_lines_expired_chk` kısıtı + yönetim kararında da). |
| Kısa raf ömrü | Ürün bazında "en az kalan gün"; altındaki ürün doğrudan kabul edilemez → yönetim incelemesi. |
| Farklı marka / yanlış ürün / hasarlı / lotsuz / sipariş dışı / fazla | Doğrudan kabul edilemez: ret veya yönetim incelemesi. **Gerçekte gelen ürün** teslimat satırında saklanır; sipariş kalemi değişmez. Bekleyenden fazla kabul edilemez. |
| Aynı ürün farklı lot/SKT ile; birden fazla teslimat | Bir kontrolde aynı kalem için birden fazla satır; bir siparişe istenen sayıda teslimat. |
| Eksik teslimat | Gelen < bekleyen ise "eksik teslimat" sorunu otomatik açılır; kalan teslim alınınca kendiliğinden çözülür. |
| Çözüm yolları | Eksik bekleme, değişim, iade, fiyat düzeltmesiyle kabul, yönetim onayıyla alternatif kabul, inceleme sonrası kabul, kalan iptali (gerekçe zorunlu). Değişim/iade, ürünün tedarikçiye geri verildiği gün girilmeden çözülmez. |
| Çözülmemiş sorun varken kapanış yok | Kapanış engelleri: bekleyen miktar, incelemedeki ürün, açık sorun, devam eden kontrol. Kalan iptali yönetim gerekçesiyle. |
| Sipariş ≠ borç ≠ ödeme | Sipariş borç yaratmaz; faturalanmamış kısım **açık satın alma taahhüdü** olarak ayrı gösterilir. Borç fatura ve açılış borcuyla oluşur. |
| Üçlü karşılaştırma | Fatura kalemi sipariş kalemine bağlanır: net birim fiyat, KDV oranı, ürün, kabul edilen miktar, sipariş miktarı, kargo ve faturada yazan toplam karşılaştırılır. Fark varsa uyarı + "inceleme bekliyor"; **borç tam tutarla kalır**. |
| Aynı fatura iki kez | (tedarikçi, normalleştirilmiş fatura no) benzersiz indeks; "abc-001" ile "ABC 001" aynı sayılır. Eşzamanlı iki gönderimde de tek kayıt. |
| Kısmi fatura / çok siparişli fatura / kısmi ödeme / avans | Kalemler farklı siparişlerden gelebilir; bir sipariş kalemi birkaç faturaya bölünebilir. Ödeme faturalara dağıtılır; dağıtılmayan kısım avanstır, sonradan dağıtılabilir. Dağıtım kalanı ve ödeme tutarını aşamaz (servis + tetikleyici). |
| Bakiye | Açılış + faturalar ± **onaylı** finansal düzeltmeler − ödemeler, para birimi başına. Fiziksel iade borcu düşürmez; iade faturası/fiyat farkı belgesi girilip onaylanmalı. |
| Para birimleri | Asla toplanmaz. TL karşılığı yalnızca kuru (oran + tarih + kaynak) girilmiş döviz belgelerinden, kuru eksik belge sayısıyla birlikte gösterilir. |
| Aylık rapor: 3 ayrı rakam | 1) verilen sipariş (verildiği gün), 2) net satın alma (fatura tarihi; faturalar ± düzeltmeler), 3) nakit çıkışı (ödeme tarihi). Ürün/kategori/tedarikçi raporu **yalnızca fatura kalemlerinden**; ödeme ürünlere dağıtılmaz. "Satın alınan miktar" tüketim, talepteki kalan "stok" olarak sunulmaz. |
| Silme yerine iptal | Fatura, ödeme, düzeltme, teslimat: gerekçeli iptal (ters kayıt); kayıt listede ve geçmişte kalır. |
| Eşzamanlılık / çift kayıt | Satır kilitleri (`for update`), sürüm (`version`) kontrolü, siparişte tek açık teslimat kontrolü (kısmi benzersiz indeks), idempotency anahtarları (talep, fatura, ödeme). İki kişi aynı teslimatı kaydederse ikincisi 409 alır, miktar bir kez işlenir. |
| Ondalık hassasiyet | Postgres `numeric`; uygulamada `decimal.js` (kayan nokta yok); satır net/KDV tutarları veritabanında hesaplanan sütunlar, ekrandaki önizleme aynı formülü kullanır (yarım yukarı yuvarlama, satır bazında). |

## 5. Veri modeli

Şema: [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql), başlangıç listeleri: [`0002_reference_data.sql`](db/migrations/0002_reference_data.sql).

```
categories ─ products ─ variants ─ variant_suppliers ─ suppliers ─ price_quotes
requests ── request_allocations ── order_lines ── purchase_orders (tek tedarikçi)
                                       │                 └── receipts ── receipt_lines (gerçek gelen ürün, lot, SKT, kabul/ret/inceleme)
                                       │                 └── delivery_issues (sorun, çözüm, iade tarihi)
                                       └── invoice_lines ── invoices (fatura / açılış borcu) ── invoice_receipts
                                                              └── payment_allocations ── payments
                                                              └── financial_adjustments (onaylı olanlar bakiyeye)
files (+ file_blobs)   audit_log (kim, ne zaman, eski → yeni)   counters (SA-2026-0001 …)   app_users (roller[])   clinics
```

Her tabloda `clinic_id` ve `klinik_ayrimi` satır güvenliği politikası vardır: ilk sürüm tek kliniktir, ama başka klinik eklendiğinde veri
veritabanı düzeyinde ayrılır (uygulama her işlemi `forClinic()` ile, kliniği ayarlayan bir işlem içinde çalıştırır).

## 6. Yerelde çalıştırma

Gereksinim: Node.js 20+ (22 önerilir). Supabase hesabı **gerekmez**.

```bash
cd satin-alma
npm install
npm run dev          # http://localhost:3400
```

- Veritabanı: `.data/pglite` klasöründe yerel deneme veritabanı (gerçek Postgres motoru, PGlite) otomatik oluşur, geçişler uygulanır ve
  **örnek veri** eklenir: bütün adlar "Örnek …"/"Demo …", klinik kaydı `is_demo` işaretli, ekranın üstünde kırmızı **"örnek veri"** şeridi.
- Giriş: parola yoktur; giriş ekranında deneme hesabı seçilir: **Demo Asistan**, **Demo Satın Alma**, **Demo Teslimat**, **Demo Finans**,
  **Demo Klinik Yöneticisi** (satın alma + finans).
- Sıfırlamak için: sunucuyu durdurun, `.data/pglite` klasörünü silin, yeniden başlatın.
- Telefonda denemek için bilgisayar ve telefon aynı ağdayken `http://<bilgisayarın-ip-adresi>:3400`.
- Üretim derlemesini yerelde denemek: `npm run build && npm run start:local-test`.

## 7. Testler

| Komut | Ne yapar |
|---|---|
| `npm test` | Birim + entegrasyon testleri (gerçek şema, bellek içi PGlite) |
| `TEST_DATABASE_URL=postgres://… npm test -- --no-file-parallelism` | Aynı testler gerçek PostgreSQL'e karşı (her test dosyası geçici veritabanı açar/siler; eşzamanlılık gerçek bağlantılarla) |
| `npm run build && npm run test:e2e` | Tarayıcı testleri (Playwright, telefon boyutu 390×844) |
| `npm run lint` · `npm run typecheck` | Kod kalitesi |

Kabul senaryoları ↔ testler (`tests/acceptance.test.ts`, `e2e/*.spec.ts`):

| # | Senaryo | Test |
|---|---|---|
| 1 | Asistan 10 kutu eldiven ister, yönetim tedarikçi seçip sipariş verir | acceptance › 1; e2e `flow.spec.ts` |
| 2 | 6 kutu gelir: 5 doğru kabul, 1 yanlış beden ret; 5 kutu açık kalır | acceptance › 2–3; e2e `flow.spec.ts` |
| 3 | Sonraki teslimat eksikleri tamamlar; yanlış ürünün değişimi ayrıca izlenir | acceptance › 2–3 |
| 4 | SKT geçmiş ürün kabul edilemez (servis + veritabanı kısıtı); kısa miat incelemeye düşer | acceptance › 4 |
| 5 | Faturadaki fiyat siparişten farklıysa uyarı | acceptance › 5; e2e `flow.spec.ts` |
| 6 | Kısmi ödeme faturanın kalanını doğru azaltır; avans ayrı | acceptance › 6; e2e `flow.spec.ts` |
| 7 | Aynı faturanın tekrar kaydı engellenir (yazım farkı ve eşzamanlı gönderim dahil) | acceptance › 7; e2e `concurrency.spec.ts` |
| 8 | Asistan doğrudan bağlantı veya API ile finansal veriye erişemez | acceptance › 8; e2e `permissions.spec.ts` (HTTP 403, sayfa yönlendirmesi) |
| 9 | İki kullanıcı aynı teslimatı eşzamanlı kaydeder → miktar bir kez | acceptance › 9; e2e `concurrency.spec.ts` |
| 10 | Aylık sipariş, satın alma ve ödeme toplamları ayrı | acceptance › 10; e2e `flow.spec.ts` |

Ayrıca: `tests/lib.test.ts` (ondalık hesap, Türkçe tutar girişi, fiyat normalizasyonu, benzer ad, fatura no anahtarı, katalog mükerrer
önleme, klinik ayrımı/RLS), `tests/seed.test.ts` (örnek verinin açıkça işaretlenmesi).

## 8. Kurulum (Supabase + Vercel)

Üç ortam ayrıdır; **her biri kendi veritabanını** kullanır: geliştirme (yerel PGlite + örnek veri), test/önizleme (ayrı Supabase projesi
veya ayrı şema, `APP_ENV_LABEL=TEST`), üretim. Üretimde yerel veritabanı ve parolasız giriş **kodla engellenmiştir**.

### 8.1 Supabase

1. Yeni proje, bölge **Central EU (Frankfurt)** (cihaz-takip ve Lions oyunu projelerinden ayrı).
2. **Authentication → Sign In / Providers**: Email açık; **"Allow new users to sign up" KAPALI** (hesapları finans/klinik yöneticisi açar).
3. **SQL Editor**: `db/migrations/0001_init.sql`, ardından `0002_reference_data.sql` (veya bilgisayardan `DATABASE_URL=… npm run db:migrate`;
   ikinci çalıştırma bir şey değiştirmez).
4. **SQL Editor**: `db/setup/app-role.sql` (parolayı değiştirerek) — uygulamanın bağlanacağı, RLS'i atlayamayan `satinalma_app` rolü.
5. **Authentication → Users → Add user**: klinik yöneticisinin e-postası ve parolası, "Auto confirm user" işaretli.
6. (Önerilir) **Storage**: `satin-alma` adlı **özel (private)** kova; `FILE_STORAGE=supabase`. Varsayılan `db` dosyaları veritabanında tutar.

### 8.2 Vercel

1. Add New → Project → bu depo, **Root Directory: `satin-alma`**. Bölge `vercel.json` ile Frankfurt.
2. Environment Variables (Production ve Preview için **ayrı değerlerle**): `DATABASE_URL` (Transaction pooler, `satinalma_app` kullanıcısı),
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BOOTSTRAP_ADMIN_EMAIL`, gerekirse `FILE_STORAGE=supabase`;
   Preview'da ayrıca `APP_ENV_LABEL=TEST`. `AUTH_MODE`, `ALLOW_*`, `LOCAL_DB_DIR` **eklenmez**.
3. Yönetici e-postasıyla giriş → otomatik olarak "satın alma + finans/klinik yöneticisi" hesabı açılır. Sonra Ayarlar → Kullanıcılar'dan
   herkese kişisel hesap ve rol verilir. `BOOTSTRAP_ADMIN_EMAIL` sonra silinebilir.

Yeni şema değişikliği (`db/migrations/000N_*.sql`) **önce test, sonra üretim** veritabanına uygulanır, ardından kod yayınlanır. Yeni tablolar
`clinic_id` + `klinik_ayrimi` politikası ve RLS ile açılmalıdır (0001'deki döngüye bakın).

## 9. Yedekleme ve geri yükleme

Bu uygulamada **finansal kayıtlar** vardır: yedek zorunludur.

1. **Üretim Supabase projesi ücretli plana (Pro) alınmalı**: günlük otomatik yedek, duraklatma yok; istenirse anlık geri dönüş (PITR).
   Ücretsiz planda indirilebilir otomatik yedek yoktur ve proje duraklatılabilir.
2. **Haftalık bağımsız yedek** (plan ne olursa olsun, kurum dışında, şifreli diskte):
   ```bash
   # "Session pooler" veya doğrudan bağlantı adresiyle (postgres kullanıcısı); pg_dump sürümü sunucuyla uyumlu olmalı
   pg_dump "$DATABASE_URL" --no-owner --no-privileges --schema=public -Fc -f satin-alma-$(date +%F).dump
   ```
   `FILE_STORAGE=db` ise fotoğraf ve fatura dosyaları bu yedeğin içindedir. `FILE_STORAGE=supabase` ise Storage kovası ayrıca yedeklenmelidir
   (Supabase panelinden indirme veya `supabase storage` komutlarıyla).
3. **Geri yükleme** (önce test projesinde prova edin):
   ```bash
   pg_restore --no-owner --no-privileges -d "$YENI_DATABASE_URL" satin-alma-2026-10-21.dump
   # ardından db/setup/app-role.sql (rol ve yetkiler)
   ```
   Giriş hesapları Supabase Auth'tadır: yeni projeye taşınırsa kullanıcılar aynı e-postalarla yeniden açılır; ilk girişte eski kayıtlarına
   otomatik bağlanırlar.
4. Ayarlar → Dışa aktarım ve Raporlar'daki CSV dosyaları okunabilir ek arşivdir; tek başına geri yükleme için yeterli değildir.
5. Ayda bir: yedekten test veritabanına geri yükleyip bakiyelerin tuttuğunu kontrol edin (Raporlar → Tedarikçi bakiyeleri CSV'si karşılaştırması).

## 10. Güvenlik

- **Yetkiler sunucuda**: her servis fonksiyonu `assertCan` çağırır; sayfalar `pageCtx(izin)` ile korunur. Asistan ve teslimat sorumlusu
  finansal uç noktalardan 403 alır; teslimat sorumlusuna giden sipariş verisinde fiyat alanları sunucuda boşaltılır.
- **Dosyalar** yalnızca uygulama üzerinden, bağlı kaydın yetkisiyle verilir (fatura/dekont: yalnızca finans). İçerik türü dosyanın ilk
  baytlarından doğrulanır; en fazla 8 MB.
- **Kimlik**: Supabase Auth (e-posta + parola); oturum her istekte Supabase'de doğrulanır. Erişimi kapatılan hesap anında düşer.
- **Klinik ayrımı** veritabanında (RLS); uygulama rolü RLS'i atlayabiliyorsa istekler reddedilir.
- **CSRF**: değişiklik yapan istekler yalnızca aynı kökenden; çerezler `SameSite=Lax`. **CSP** `default-src 'self'`, iframe'e gömülemez,
  arama motorlarına kapalı. CSV'de formül enjeksiyonu etkisizleştirilir.
- Anahtarlar yalnızca sunucu ortam değişkenlerinde; hiçbir değişken `NEXT_PUBLIC_` değildir.
- **Hasta verisi toplanmaz**; açıklama ve fotoğraf alanlarında hasta bilgisi bulunmaması ekranda hatırlatılır.

## 11. Varsayımlar ve karar bekleyen konular

Geri alınabilir teknik kararlar şöyle verildi:

- Ayrı uygulama (`satin-alma/`), cihaz-takip ile aynı yığın; giriş kişisel hesaplarla (ortak şifre yok).
- Kullanıcı yönetimi finans / klinik yöneticisi rolündedir; ilk yönetici "satın alma + finans" rolleriyle açılır.
- Fatura, ödeme, borç ve finansal raporlar yalnızca finans rolünde; satın alma fiyat geçmişini ve sipariş tutarlarını görür.
- Sipariş birimi tedarikçiden bağımsız varyant birimidir; farklı paket = farklı varyant. Alternatif ürün kabulünde, gelen ürün siparişteki
  birimle sayılır.
- Teslimat sorumlusu sipariş verilirken zorunlu atanır; beklenen teslim tarihi zorunludur.

**Finansal hesaplamayı veya iş akışını etkileyen, onayınızı bekleyen konular:**

1. **KDV ve iskonto yuvarlaması** satır bazında yapılıyor (her kalemin KDV'si ayrı yuvarlanır). Tedarikçileriniz toplam üzerinden yuvarlıyorsa
   kuruş farkları "faturada yazan toplam" uyarısı olarak görünür. Hangisi kullanılmalı?
2. **Fatura farkını kim onaylar?** Şu an finans. Fiyat farkını satın alma mı değerlendirmeli? Satın alma rolü borç/ödeme görmeli mi?
3. **Finansal düzeltmelerde dört göz**: düzeltmeyi giren kişi kendisi onaylayabiliyor (ikisi de kaydediliyor). Farklı kişi zorunlu olsun mu?
4. **Aylık "verilen sipariş" tutarı** siparişin güncel miktarıyla hesaplanıyor; sonradan iptal edilen kalan miktar düşülmüyor. Düşülsün mü?
5. **Varsayılan KDV oranı** ürün kartında 20 (eldivende 10 girildi). Tıbbi sarflar için kliniğin kullandığı oranlar teyit edilmeli.

## 12. Bilinen sınırlamalar ve sonraki adımlar

- Stok/tüketim kaydı yoktur (bilinçli): satın alınan miktar tüketim, talepteki kalan miktar stok sayımı değildir.
- Otomatik WhatsApp/e-posta, tedarikçi portalı, barkod donanımı, AI tahminleme, çok şubeli yönetim ilk sürümde yok.
- Fatura kalemleri kayıttan sonra değiştirilemez (iptal + yeniden giriş). Vade, not ve kur düzeltilebilir.
- Teslimat kaydı kaydedildikten sonra değiştirilemez; yanlışsa gerekçeli ters kayıt yapılıp yeniden girilir. Karara bağlanmış sorunu olan
  teslimat iptal edilemez.
- `FILE_STORAGE=supabase` sürücüsü yazıldı ama bu ortamda gerçek Supabase'e karşı denenmedi (testler veritabanı sürücüsüyle çalışır).
  Supabase Auth girişi de bu ortamda canlı olarak denenmedi (cihaz-takip ile aynı kod yolu).
- Çevrimdışı çalışmaz; talep formu yazıldıkça cihazda taslak olarak tutulur.
- Kur bilgisi elle girilir (TCMB'den otomatik çekilmez).

### Kod yapısı

```
db/migrations/        SQL şema ve başlangıç listeleri      db/setup/app-role.sql  uygulama rolü
src/server/           db (pg / PGlite, klinik ayrımı), auth, permissions, audit, http, routes (bütün API uçları tek tabloda)
src/server/services/  catalog, suppliers, requests, orders, order-state, receipts, issues, invoices, payments, adjustments,
                      balances, reports, dashboard, export, files, users, lookups
src/app/(app)/        oturum gerektiren sayfalar;  src/app/api/[...path]  API dağıtıcı
src/components/       ortak bileşenler (ActionPanel: onay/ret/iptal formları, VariantPicker, Files, listeler)
src/lib/              ondalık hesap, tarih, Türkçe karşılaştırma, fiyat normalizasyonu, etiketler
tests/                birim + entegrasyon (kabul senaryoları);  e2e/  Playwright
```
