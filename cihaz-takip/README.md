# DENTINEL

**DENTINEL**, diş kliniklerinin **cihaz envanteri, arıza ve teknik servis takip** uygulaması. İlk klinik Özel Koşuyolu Park
Ağız ve Diş Sağlığı Polikliniği'dir; genel yönetici başka klinikler de açabilir (**her kliniğin verisi ayrıdır**, bkz. 3.1).
Klinik bilgisayarlarından ve çalışanların telefonlarından kullanılan, mobil uyumlu bir web uygulamasıdır (PWA: telefonda
"Ana ekrana ekle" ile uygulama gibi açılır).

> Bu klasör depodaki Lions oyunundan **bağımsızdır**: kendi `package.json`'ı, veritabanı ve yayın ayarları vardır.
> İleride ayrı bir depoya taşınması yalnızca klasörün kopyalanmasıdır.

- [1. Ürün özeti](#1-ürün-özeti)
- [2. Platform ve teknoloji kararı](#2-platform-ve-teknoloji-kararı)
- [3. Veri modeli](#3-veri-modeli)
- [4. Ekranlar ve akış](#4-ekranlar-ve-akış)
- [5. Kurallar nasıl uygulanıyor](#5-kurallar-nasıl-uygulanıyor)
- [6. Yerelde çalıştırma ve deneme](#6-yerelde-çalıştırma-ve-deneme)
- [7. Testler](#7-testler)
- [8. Ortamlar ve yayına alma (Supabase + Vercel)](#8-ortamlar-ve-yayına-alma-supabase--vercel)
- [9. Yedekleme ve geri yükleme](#9-yedekleme-ve-geri-yükleme)
- [10. Güvenlik](#10-güvenlik)
- [11. Geliştirme planı](#11-geliştirme-planı)
- [12. Bilinen sınırlamalar](#12-bilinen-sınırlamalar)

---

## 1. Ürün özeti

**Kim kullanır?** Hekimler, asistanlar, sekreterler, klinik müdürü (personel rolü) ve klinik sahibi/müdür (yönetici rolü).

**Ne yapar?**

| İş | Nasıl |
|---|---|
| Her fiziksel cihazı ayrı takip | Her cihaz ayrı kart ve benzersiz envanter kodu (AER-001, ANG-001, UNT-01…). Aynı modelden 3 aeratör = 3 kart. |
| Kim nerede, kimin sorumluluğunda | Oda/ünit, sorumlu çalışan, diğer kullanıcılar. Değişiklikler eski → yeni değerleriyle geçmişe yazılır. |
| Arıza bildirimi | Cihaz kartından tek düğme: cihaz ve konum dolu gelir; "Ne oldu?" yazıp kaydetmek yeterli. |
| Servis takibi | Arızalı → Serviste → Tamirden geldi. Serviste seçilince servis alanları, tamirden geldi seçilince dönüş alanları açılır. |
| Yönetim soruları | 1) Hangi cihaz en sık tamire gidiyor? 2) Aylık tamir maliyeti ne kadar? 3) En çok hangi nedenle arıza oluyor? |

**Bilinçli olarak yapılmayanlar (ilk sürüm):** hasta verisi, randevu, stok, muhasebe/ödeme, yapay zekâ tahmini, kullanım sayacı
("100 kullanımda arıza" gibi), çok klinikli SaaS, onay zinciri, zorunlu bakım listesi, ayrı native iOS uygulaması.

## 2. Platform ve teknoloji kararı

**Karar: tek bir mobil uyumlu web uygulaması (PWA).** Native iOS uygulaması ilk aşamada yapılmadı.

| Ölçüt | Web/PWA | Native iOS |
|---|---|---|
| Erişim | Bilgisayar ve her telefonda tarayıcı; kurulum yok | Yalnızca iPhone; App Store/TestFlight dağıtımı gerekir; banko bilgisayarında çalışmaz |
| Güncelleme | Yayınlanınca herkeste anında | Mağaza onayı ve her cihazda güncelleme |
| Maliyet / bakım | Tek kod tabanı | İkinci bir uygulama + Apple geliştirici hesabı |
| Kamera / QR | Cihaz etiketindeki QR, telefonun **kendi kamerasıyla** okutulunca cihaz kartı açılır (`/c/AER-001` adresi hazır). Uygulama içi tarama da web kamerasıyla mümkün. | Daha hızlı tarama, ama bu ihtiyaç için gerekmiyor |
| Ortak, kalıcı veri | Merkezî veritabanı; herkes aynı güncel kaydı görür | Aynı (sunucu yine gerekir) |

Native uygulama ancak çevrimdışı çalışma, push bildirim yoğunluğu ya da sık barkod taraması gibi somut bir ihtiyaç doğarsa
düşünülmeli.

**Teknoloji (sade ve yaygın):**

- **Next.js 16 + React 19 + TypeScript + Tailwind** — depodaki diğer projeyle aynı yığın; ekip zaten Vercel'de işletiyor.
- **PostgreSQL (Supabase)** — ilişkisel, kalıcı, merkezî veritabanı. Sunucu doğrudan SQL ile konuşur (`pg`).
- **Supabase Auth** — hazır kimlik doğrulama (e-posta + parola). Parolalar uygulamada saklanmaz, şifreleme kendimiz yazılmadı.
- **Vercel** — yayın (Frankfurt bölgesi, veritabanıyla aynı yerde).
- Yerel geliştirme ve testler için **PGlite** (tarayıcı/Node içinde çalışan gerçek Postgres) — kurulum gerektirmez; aynı SQL
  testlerde ayrıca gerçek PostgreSQL 16'ya karşı da koşulur.

Mimari tek katmanlıdır: tarayıcı → Next.js sunucusu (sayfalar + `/api/*`) → PostgreSQL. **Tarayıcı veritabanına hiç
bağlanmaz**; tüm yetki kontrolleri sunucudaki servis fonksiyonlarındadır.

## 3. Veri modeli

Şema: [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql), başlangıç listeleri: [`0002_reference_data.sql`](db/migrations/0002_reference_data.sql).

```
locations ─┐            device_types ─┐                 fault_causes ─┐      service_vendors ─┐
           │                          │                               │                       │
staff ─────┼── devices (1 fiziksel cihaz) ── device_users (diğer kullanıcılar, N:N)            │
  │        │      │                                                   │                       │
  │        │      └── faults (her arıza olayı ayrı) ──────────────────┘                       │
  │        │             │  fark eden / son kullanıcı / doğrulanmış sorumlu / doğrulayan: ayrı alanlar
  │        │             └── service_visits (her satır = 1 tamire gidiş) ─────────────────────┘
  │
app_users (giriş hesabı; isteğe bağlı olarak bir personel kartına bağlı)       audit_log (işlem geçmişi)
```

| Tablo | Öne çıkan alanlar ve kurallar |
|---|---|
| `devices` | `inventory_code` benzersiz; `serial_number`, marka, model **isteğe bağlı**; `lifecycle`: aktif / kullanım dışı / envanterden çıkarıldı. Cihaz silinmez. |
| `staff` | Ad, görev (8 grup), aktif/pasif, oda, iş e-postası, not. `name_key` ile aynı kişinin farklı yazımı yakalanır. Silinmez, pasif yapılır. |
| `clinics` | Klinik adı, erişim açık/kapalı. Diğer bütün tablolarda `clinic_id` vardır (bkz. 3.1). |
| `app_users` | Giriş hesabı ≠ personel kartı. Rol: `admin` / `staff`. `auth_user_id` = Supabase Auth kullanıcısı. `clinic_id` boşsa **genel yönetici**; `shared` = kliniğin **ortak girişi** (personel şifresi / yönetici şifresi). |
| `faults` | Açıklama, fark edilme tarihi, fark eden, son bilinen kullanıcı, konum, neden + doğrulama durumu, (isteğe bağlı) doğrulanmış sorumlu + kanıt + doğrulayan, durum, `closed_at`, mantıksal silme ve silme talebi alanları. |
| `service_visits` | Firma, gönderim, beklenen dönüş (ileri tarih olabilir), döndü mü, gerçek dönüş, yapılan işlem, **maliyet (boş = bilinmiyor, 0 = ücretsiz)**, **masraf tarihi**, fiş referansı, sonuç (kullanıma hazır / sorun devam ediyor / henüz denenmedi). |
| `audit_log` | Kim, ne zaman, hangi kayıtta, neyi neyden neye değiştirdi. Değişiklikle aynı işlemde yazılır. |

Veritabanı düzeyindeki güvenceler:

- `faults_one_open_per_device`: aynı cihazda aynı anda **en fazla bir açık ve silinmemiş** arıza (eşzamanlı iki bildirimde bile).
- Sorumluluk atanırsa kanıt ve doğrulayan kişi zorunlu (`faults_responsibility_chk`).
- Dönüş tarihi gönderimden önce olamaz; dönmemiş gidişte sonuç olamaz; maliyet negatif olamaz.
- Her tabloda `version` sütunu: eşzamanlı düzenlemede eski sürümle yapılan kayıt reddedilir.
- Tüm tablolarda RLS açık; anon/authenticated rollerinin yetkisi kaldırılmıştır: Supabase'in otomatik veri API'si (anon anahtar)
  tablolara erişemez. Klinik ayrımı da RLS ile yapılır (3.1).

### 3.1 Birden fazla klinik

Geçişler: [`0004_clinics.sql`](db/migrations/0004_clinics.sql) (geçiş aşaması) ve [`0005_clinics_strict.sql`](db/migrations/0005_clinics_strict.sql).

- Klinik verisi tutan her tabloda `clinic_id` ve `klinik_ayrimi` politikası vardır: bir işlem yalnızca `app.clinic_id`
  ayarındaki kliniğin satırlarını görür, yalnızca o kliniğe satır ekler/değiştirir. Ayar yoksa **hiçbir satır görünmez**.
- Uygulama her isteği `forClinic(db, actor.clinicId)` bağlantısıyla çalıştırır ([`src/server/db.ts`](src/server/db.ts)): her sorgu,
  kliniği ayarlayan bir işlem (transaction) içinde koşar. Servis kodunda klinik süzgeci yazılmaz; unutulamaz.
- Uygulama rolleri (`cihaz_app`, `cihaz_onizleme`) **NOBYPASSRLS**'tir ve tablo sahibi değildir. Rol RLS'i atlayabiliyorsa
  uygulama klinik isteğini reddeder (yanlış yapılandırmada sessizce bütün klinikleri göstermez).
- Envanter kodu, çalışan adı ve liste adları **klinik içinde** benzersizdir (iki klinikte de `AER-001` olabilir).
- Yeni klinik, başlangıç listeleriyle ([`src/server/clinic-defaults.ts`](src/server/clinic-defaults.ts), 0002 ile aynı) açılır.
- **Giriş**: giriş ekranında klinik seçilir (cihazda hatırlanır), sonra **personel şifresi** ya da **yönetici şifresi** yazılır.
  Şifreler kliniğin iki ortak Supabase Auth hesabındadır (adları `personel.<klinik>@klinik.dentinel.invalid`; bu adrese e-posta
  gitmez). Uygulama şifre saklamaz. İki şifre aynı olamaz. Şifre değişince o girişle açılmış eski oturumlar kapanır.
- **Genel yönetici** (ilk yönetici hesabı) "E-posta ile giriş" ile girer, çalışacağı kliniği seçer; Ayarlar → Klinikler'den
  klinik açar, adını/erişimini değiştirir, şifreleri belirler. Kliniğin yöneticisi kendi kliniğinin şifrelerini değiştirebilir.
- Kişisel hesaplar (e-posta + parola) isteğe bağlı olarak sürer; klinik içindedir.
- **Yayın sırası**: 0004 eski sürümle uyumludur (klinik ayarı olmayan istek ilk kliniği görür) → yeni sürüm yayınlanır → 0005
  uygulanır (geçiş kolaylığı kalkar).

## 4. Ekranlar ve akış

| Ekran | Adres | Kim |
|---|---|---|
| Genel bakış: toplam cihaz, şu an kullanılamayan, serviste, geciken servis, bu ayın tamir maliyeti (yönetici) | `/` | herkes |
| Cihaz envanteri: ad, kod, marka/model, seri no, kişi, konuma göre arama + tür/konum/kişi/durum süzgeci | `/cihazlar` | herkes |
| Cihaz kartı: bilgiler, durum, "Arıza bildir", arıza/servis geçmişi, konum/sorumlu değişiklik geçmişi | `/cihazlar/[id]` | herkes |
| Arıza & servis: açık / serviste / gecikenler / kapananlar / tümü (+ yönetici: silme talepleri, silinenler) | `/arizalar` | herkes |
| Arıza bildir (cihaz seç → kısa form) ve arıza kaydı (durum, servis, dönüş, gidişler, silme) | `/arizalar/yeni`, `/arizalar/[id]` | herkes |
| Analizler: 3 yönetim sorusu, dönem seçimi, Excel | `/analizler` | yönetici |
| Çalışanlar | `/calisanlar` | yönetici |
| Ayarlar: giriş ve erişim (klinik şifreleri, kişisel hesaplar), listeler (konum, tür, neden, servis firması), işlem geçmişi, dışa aktarım | `/ayarlar/*` | yönetici |
| Hesabım (parola değiştirme; ortak girişte yok) | `/hesabim` | herkes |
| Giriş: klinik seç → personel / yönetici şifresi; "E-posta ile giriş" (genel yönetici, kişisel hesaplar) | `/giris` | herkes |
| Klinik seç / değiştir | `/klinik-sec` | genel yönetici |
| Klinikler: klinik aç, ad/erişim, şifreler | `/ayarlar/klinikler` | genel yönetici |

Telefonda alt menünün ortasında büyük **"+ Arıza bildir"** düğmesi vardır. Sıradan bir arıza bildirimi: cihaz kartı →
"Arıza bildir" → "Ne oldu?" → "Arızayı kaydet" (tarih bugün, fark eden giriş yapan kişinin personel kartı, konum cihazın
konumu, neden "Belirlenmedi" olarak hazır gelir). Ayrıntılar (son kullanıcı, neden, doğrulama) katlanmış bölümdedir.

## 5. Kurallar nasıl uygulanıyor

| İstek | Uygulama |
|---|---|
| Seri no / firma / tarih bilinmiyorsa kayıt engellenmesin | Bu alanlar isteğe bağlı; eksikler sonradan doldurulur. Cihazda zorunlu: ad + tür. Arızada zorunlu: cihaz + açıklama. |
| Hata mesajı alanı söylesin | Her hata alanın altında ve formun üstünde liste hâlinde: "Gönderim tarihi, arızanın fark edildiği tarihten (10.10.2026) önce olamaz." |
| Gerçekleşmiş tarihler gelecekte olamaz | Fark edilme, gönderim, gerçek dönüş, masraf tarihi ≤ bugün (İstanbul saatiyle). Beklenen dönüş serbest. |
| Gecikme kaydı engellemesin | Beklenen dönüş geçince "Serviste – gecikti (N gün)" görünür; kayıt yine güncellenir. |
| Aynı servis kaydını düzenlemek yeni gidiş sayılmasın | Tamire gidiş = `service_visits` satırı. Düzenleme aynı satırı günceller. "Tamirden geldi" sonrası "Serviste" seçilirse uygulama sorar: *tekrar gönderildi (yeni gidiş)* mi, *yanlışlıkla seçilmişti (geri al)* mı. Yanlışlıkla "Serviste" yapılan kayıt "Arızalı"ya döndürülünce o gidiş iptal edilir ve sayılmaz. |
| "Tamirden geldi" ≠ onarıldı | Dönüşte tek seçim: **Kullanıma hazır** (arıza kapanır) / **Sorun devam ediyor** / **Henüz denenmedi** (ikisinde de cihaz kullanılamaz görünür). Ek aşama yok. |
| Gerçek dönüş tarihi bilinmiyorsa tarih uydurma | Boş kalır; servis süresi "hesaplanamadı: gerçek dönüş tarihi girilmemiş" olarak gösterilir. |
| Mükerrer arıza önleme | Açık arızası olan cihaz için "Arıza bildir" mevcut kayda yönlendirir; veritabanı da ikinci açık kaydı reddeder. |
| Servise gitmeden giderilen arıza | "Servise gitmeden çözüldü" seçeneğiyle kapatılır (onay adımı değildir). |
| Fark eden ≠ son kullanan ≠ sorumlu | Üç ayrı alan; kimse otomatik sorumlu yapılmaz. Sorumluluk ataması yalnızca yöneticide, kanıt + doğrulayan zorunlu, varsayılan olarak katlı. |
| Neden bilinmiyorsa zorlama | Varsayılan "Belirlenmedi"; doğrulama durumu "Ön değerlendirme". |
| Maliyet ayı | Masraf tarihine göre. Masraf tarihi yoksa hiçbir aya yazılmaz, "Tarihi eksik" listesinde görünür. Dönüş tarihini masraf tarihine kopyalamak için ayrı düğme var (otomatik atanmaz). |
| Boş tutar ≠ 0 TL | Boş = bilinmiyor ("Tutarı girilmemiş dönüş" listesi); 0 = ücretsiz (ayrı sayılır). |
| Kişi bazlı inceleme, ama "kim bozuyor" sıralaması yok | Arıza listesinde kişi seçilince o kişinin geçtiği kayıtlar ve rolü (fark eden / son kullanıcı / doğrulanmış sorumlu) görünür. Kişi sıralaması hiçbir yerde üretilmez. |
| Silme | Yönetici: onay penceresinde cihaz ve arıza bilgisi gösterilir → mantıksal silme (kim/ne zaman/neden kaydedilir), geri alma, gerekirse kalıcı silme. Personel: "Silinmesini iste". Silinen arıza hiçbir sayıma girmez, cihaz kartı kalır, açık arıza silinince cihaza yeni arıza açılabilir. |
| Eşzamanlı düzenleme | Eski sürümle kaydetme reddedilir; kullanıcıya "güncel hâli yükle" veya "benim değişikliklerimi bilerek üzerine kaydet" seçenekleri sunulur. |
| Oturum kesilirse bilgi kaybolmasın | Formlar yazıldıkça tarayıcıda taslak olarak tutulur (yalnızca taslak; asıl veri sunucuda). Oturum düşerse "Tekrar giriş yap" aynı sayfaya döner ve form dolu açılır. Çıkışta taslaklar silinir. |

## 6. Yerelde çalıştırma ve deneme

Gereksinim: Node.js 20+ (22 önerilir). Supabase hesabı **gerekmez**.

```bash
cd cihaz-takip
npm install
npm run dev          # http://localhost:3200
```

- Veritabanı: `.data/pglite` klasöründe yerel deneme veritabanı otomatik oluşur, geçişler uygulanır ve **örnek veri** eklenir
  (adları "Örnek …", "Demo …"; ekranın üstünde kırmızı "GELİŞTİRME ORTAMI" şeridi görünür).
- Giriş: parola yoktur; giriş ekranında **Demo Yönetici** veya **Demo Personel** seçilir.
- Sıfırlamak için: sunucuyu durdurun, `.data/pglite` klasörünü silin, yeniden başlatın.
- Telefonda denemek için bilgisayar ve telefon aynı ağdayken `http://<bilgisayarın-ip-adresi>:3200`.

Üretim derlemesini yerelde denemek: `npm run build && npm run start:local-test` (yine yerel deneme veritabanı ve deneme girişi).

## 7. Testler

| Komut | Ne yapar |
|---|---|
| `npm test` | Birim + entegrasyon testleri (gerçek şema, bellek içi PGlite) |
| `TEST_DATABASE_URL=postgres://… npm test -- --no-file-parallelism` | Aynı testler gerçek PostgreSQL'e karşı (her test kendi geçici veritabanını açar/siler) |
| `npm run build && npm run test:e2e` | Tarayıcı testleri (Playwright, telefon boyutu 390×844 ve masaüstü) |
| `npm run build && npx playwright test -c playwright.supabase.config.ts` | **Gerçek Supabase Auth'a karşı** giriş testleri: hatalı parola, ilk yönetici, yöneticinin hesap açması, personelin yönetici API'lerine erişememesi, parola değiştirme, erişim kapatınca açık oturumun anında düşmesi, parola sıfırlama, Supabase'de olup uygulamada kaydı olmayan kişinin girememesi. Bir TEST Supabase projesi ve `playwright.supabase.config.ts` içinde yazan değişkenler gerekir (CI'da çalışmaz). **Üretim veritabanına karşı çalıştırmayın.** |
| `npm run lint` · `npm run typecheck` | Kod kalitesi |

Kabul senaryoları ↔ testler:

| # | Senaryo | Test |
|---|---|---|
| 1 | Aynı modelde iki cihaz ayrı kodlarla | `tests/acceptance.test.ts` › 1 |
| 2 | Seri no olmadan cihaz | › 2; e2e `flow.spec.ts` (telefonda) |
| 3 | Tüm görev gruplarından çalışan, cihaz sorumlusu | › 3; e2e `admin.spec.ts` |
| 4 | Temel bilgilerle arıza | › 4; e2e `flow.spec.ts` |
| 5 | Firma ve gönderim tarihi boşken "Serviste" | › 5–7; e2e `flow.spec.ts` |
| 6 | Beklenen dönüş ileri tarih | › 6; e2e `flow.spec.ts` |
| 7 | Gecikmede kayıt engellenmez | › 7 |
| 8 | Aynı servis kaydının güncellenmesi gidiş sayısını artırmaz | › 8 |
| 9 | Sorun devam eden cihaz kullanılabilir sayılmaz | › 9; e2e `flow.spec.ts` |
| 10 | Maliyet doğru aya, tarihi eksik ayrı | › 10 |
| 11 | Deneme arızası silinince analizden çıkar, cihaz kalır | › 11; e2e `admin.spec.ts` |
| 12 | Pasif personelin geçmişi korunur | › 12; e2e `admin.spec.ts` |
| 13 | Personel yönetici işlemlerini API'den de yapamaz | › 13; e2e `permissions.spec.ts` (HTTP 403) |
| 14 | Yenileme / başka cihazdan girişte kayıtlar korunur | e2e `flow.spec.ts` (yenileme + ayrı oturum) |
| 15 | Mobilde temel kayıt akışı | e2e `flow.spec.ts` (390×844) |

## 8. Ortamlar ve yayına alma (Supabase + Vercel)

Üç ortam birbirinden ayrıdır; **her biri kendi veritabanını** kullanır:

| Ortam | Veritabanı | Giriş | Nerede |
|---|---|---|---|
| Geliştirme | Yerel PGlite (`.data/`) + örnek veri | Parolasız deneme girişi | Geliştiricinin bilgisayarı |
| Test / önizleme | Ayrı Supabase projesi (ör. `kosuyolu-cihaz-test`) ya da ücretsiz planda aynı projede ayrı şema + ayrı rol (bkz. 8.0) | Supabase Auth ya da deneme girişi | Vercel "Preview" ortamı, `APP_ENV_LABEL` ile kırmızı şerit |
| Üretim | Ayrı Supabase projesi (ör. `kosuyolu-cihaz`) — **Lions oyununun projesi değil** | Supabase Auth | Vercel "Production" ortamı |

Üretimde yerel veritabanı ve parolasız giriş **kodla engellenmiştir** (yapılandırma eksikse uygulama açılmaz, sessizce yerel
veriye düşmez).

### 8.0 Bu kliniğin kurulumu (17.10.2026)

| Bileşen | Durum |
|---|---|
| Supabase projesi | `kosuyolu-cihaz-takip` (Frankfurt, **ücretsiz plan**). Şema (0001, 0002) uygulandı. |
| Veritabanı bağlantısı | Uygulama `postgres` yönetici rolüyle değil, yalnızca veri okuma/yazma yetkisi olan **`cihaz_app`** rolüyle bağlanır (tablo silme/değiştirme yetkisi yok). Yeni geçişler `postgres` rolüyle uygulanır; yeni tablolar varsayılan yetkilerle bu role otomatik açılır. |
| Vercel projesi | `kosuyolu-cihaz-takip` (kök klasör `cihaz-takip`, Frankfurt). **Üretim** = main dalı → Supabase. Üretim adresi herkese açık (uygulamanın kendi girişi var); dağıtıma özel adresler ve önizlemeler Vercel girişiyle korumalı. |
| Önizleme / test (PR ve dal yayınları) | Ücretsiz planda ikinci bir Supabase projesi açılamadığı için test verisi aynı sunucuda **ayrı bir şemada** (`onizleme`) tutulur. Önizlemeler yalnızca bu şemaya erişebilen **`cihaz_onizleme`** rolüyle bağlanır; üretim tablolarını göremez (üretim rolü de önizleme tablolarını göremez). Parolasız deneme girişi + örnek veri (`SEED_DEMO=1`), kırmızı “ÖNİZLEME” şeridi, Vercel girişiyle korumalı. Yeni geçişler **önce `onizleme` şemasına**, sonra üretime uygulanır. Pro plana geçilirse ayrı bir test projesi daha güçlü bir ayrım sağlar. |
| Giriş hesabı açma | `SUPABASE_SERVICE_ROLE_KEY` Vercel'e eklenene kadar yönetici kullanıcıyı uygulamada tanımlar, giriş hesabını Supabase panelinden (Authentication → Users → Add user, “Auto confirm user”) aynı e-postayla açar; kişi ilk girişte kaydına bağlanır. Anahtar eklenince hesap açma ve parola sıfırlama uygulamadan yapılır. **Klinik şifreleri (ortak girişler) yalnızca bu anahtarla belirlenebilir.** |
| Birden fazla klinik (18.10.2026) | 0004 üretime ve önizlemeye uygulandı (mevcut kayıtlar "Koşuyolu Park" kliniğine bağlandı, ilk yönetici genel yönetici oldu, `cihaz_app`/`cihaz_onizleme` NOBYPASSRLS). 0005 önizlemeye uygulandı; üretime yeni sürüm yayınlandıktan sonra uygulanır. |

### 8.1 Supabase

1. Yeni proje: bölge **Central EU (Frankfurt)**. Veritabanı parolasını güvenli yerde saklayın.
2. **Authentication → Sign In / Providers**: Email açık; **"Allow new users to sign up" KAPALI** (hesapları yalnızca yönetici açar).
3. **SQL Editor**: `db/migrations/0001_init.sql`, ardından `0002_reference_data.sql` dosyasının tamamını yapıştırıp çalıştırın.
   (Alternatif: bilgisayarınızdan `DATABASE_URL=… npm run db:migrate`; ikinci kez çalıştırmak bir şey değiştirmez.)
4. **Authentication → Users → Add user**: klinik yöneticisinin e-postası ve parolası, "Auto confirm user" işaretli.
5. Değerler (Project Settings):
   - `SUPABASE_URL` (API URL), `SUPABASE_ANON_KEY` (anon/publishable), `SUPABASE_SERVICE_ROLE_KEY` (service_role/secret — **gizli**)
   - `DATABASE_URL`: Database → Connection string → **Transaction pooler** (port 6543) adresi, parolasıyla.

### 8.2 Vercel

1. Add New → Project → bu depo. **Root Directory: `cihaz-takip`** (Lions oyunu ayrı projede kalır).
2. Environment Variables (Production ve Preview için **ayrı değerlerle**): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `BOOTSTRAP_ADMIN_EMAIL` (4. adımdaki e-posta), Preview'da ayrıca `APP_ENV_LABEL=TEST`.
   `AUTH_MODE`, `ALLOW_*`, `LOCAL_DB_DIR` **eklenmez**.
3. Deploy. Bölge `vercel.json` ile Frankfurt.
4. Yönetici e-postasıyla giriş yapın → otomatik olarak yönetici hesabı oluşur. Sonra `BOOTSTRAP_ADMIN_EMAIL` silinebilir.
5. Ayarlar → Klinikler: her kliniğin personel ve yönetici şifresini belirleyin; çalışanlar giriş ekranında kliniği seçip
   şifreyle girer. Çalışanlar → personel kartlarını girin. (İsteyene Ayarlar → Giriş ve erişim'den kişisel hesap da açılabilir.)

Yeni sürümde şema değişikliği varsa (`db/migrations/000N_*.sql`) **önce test, sonra üretim veritabanına** uygulanır, ardından
kod yayınlanır. Yeni tablo ekleyen geçişlerde de `enable row level security` ve anon/authenticated yetkilerinin kaldırılması
(0001'deki gibi) unutulmamalıdır.

## 9. Yedekleme ve geri yükleme

Supabase'in **ücretsiz planında indirilebilir otomatik yedek yoktur** ve düşük kullanımlı ücretsiz projeler bir hafta sonra
duraklatılabilir ([Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups),
[Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod),
[Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). Gerçek klinik verisi için öneri:

1. **Üretim projesi ücretli plana (Pro) alınır**: günlük otomatik yedek (7 gün saklama) ve duraklatma yok; istenirse
   anlık geri dönüş (PITR) eklentisi.
2. **Ayrıca haftalık bağımsız yedek** (plan ne olursa olsun, kurum dışında saklanır):
   ```bash
   # Supabase "Session pooler" veya doğrudan bağlantı adresiyle; pg_dump sürümü sunucu sürümüyle uyumlu olmalı
   pg_dump "$DATABASE_URL" --no-owner --no-privileges --schema=public -Fc -f cihaz-takip-$(date +%F).dump
   ```
   Dosya şifreli bir diskte / kurum bulut deposunda saklanır (hasta verisi içermez ama personel adları içerir).
3. **Geri yükleme** (önce test projesinde prova edin):
   ```bash
   pg_restore --no-owner --no-privileges -d "$YENI_DATABASE_URL" cihaz-takip-2026-10-17.dump
   ```
   Giriş hesapları Supabase Auth'tadır: yeni projeye taşınırsa kullanıcılar yeniden açılır; ilk girişte aynı e-postayla eski
   kayıtlarına otomatik bağlanırlar.
4. Ayarlar → Dışa aktarım'daki Excel dosyaları insan tarafından okunabilir ek arşivdir; tek başına geri yükleme için yeterli değildir.

## 10. Güvenlik

- **Yetkiler sunucuda**: her servis fonksiyonu işlemden önce `assertCan(actor, izin)` çağırır ([`src/server/permissions.ts`](src/server/permissions.ts)).
  Düğme gizlemek yalnızca kolaylıktır. Personel; cihaz ekler/düzenler, arıza bildirir, servis bilgisini günceller, servis firması
  ekler, silme talebi gönderir. Diğer her şey (silme, geri alma, kalıcı silme, envanterden çıkarma, kod değiştirme, sorumluluk
  ataması, personel/kullanıcı/liste yönetimi, analizler, maliyetler, dışa aktarım, işlem geçmişi) yöneticidedir.
- **Kimlik doğrulama**: Supabase Auth; oturum her istekte Supabase'de doğrulanır (`getUser`). Uygulama hesabı pasif yapılınca
  erişim anında kesilir ve Supabase'de de giriş engellenir. Son aktif yönetici kendini düşüremez. Klinik şifresi değişince o
  girişin eski oturumları kapanır (oturumun açıldığı an, erişim anahtarındaki `amr` kaydından okunur).
- **Klinik ayrımı** veritabanında (RLS) uygulanır; bkz. 3.1. Klinikler arası işlemler (klinik açma, şifre) yalnızca genel yöneticide.
- **Ortak şifre**: Klinik şifresi kişiye özel değildir; işlem geçmişinde kişi adı yerine "Ortak personel girişi" görünür. Şifre
  yalnızca o kliniğin çalışanlarıyla paylaşılmalı, ayrılan çalışan olunca değiştirilmelidir. Kişi bazında iz isteyen klinik
  kişisel hesap kullanabilir.
- **Anahtarlar** yalnızca sunucu ortam değişkenlerindedir; hiçbir değişken `NEXT_PUBLIC_` değildir, tarayıcıya anahtar gitmez.
- **CSRF**: değişiklik yapan istekler yalnızca aynı kökenden kabul edilir; çerezler `SameSite=Lax`.
- **İçerik güvenliği**: dış kaynak yüklenmez (CSP `default-src 'self'`), arama motorlarına kapalı, iframe'e gömülemez.
- **Excel formül enjeksiyonu**: `=`, `+`, `-`, `@` ile başlayan hücreler etkisizleştirilir.
- Hasta verisi bu uygulamanın kapsamı dışındadır; alanlara hasta bilgisi yazılmaması personele hatırlatılmalıdır.

## 11. Geliştirme planı

| Aşama | İçerik | Durum |
|---|---|---|
| 1. İlk sürüm | Envanter, personel, arıza + servis akışı, analizler, roller, işlem geçmişi, silme/geri alma, Excel, testler | **Bu sürüm** |
| 2. Pilot (1–2 hafta) | Test ortamında klinik ekibiyle deneme, form alanlarının sadeleştirilmesi, gerçek envanterin girilmesi | Sıradaki |
| 3. QR etiketler | Envanter koduna göre QR etiket yazdırma (adres hazır: `/c/AER-001`), telefon kamerasıyla aç → arıza bildir | Sonraki sürüm |
| 4. Belgeler | Servis raporu / fiş fotoğrafı ekleme (Supabase Storage) | Sonraki sürüm |
| 5. Hatırlatmalar | Geciken servis ve bakım hatırlatma e-postaları | Sonraki sürüm |

## 12. Bilinen sınırlamalar

- **Çevrimdışı çalışmaz**: kayıt için internet gerekir. Bağlantı koparsa girilen bilgiler taslak olarak cihazda kalır, bağlantı
  gelince "Kaydet" tekrar denenir.
- Servis gidişinin dönemi gönderim tarihine göre sayılır; gönderim tarihi girilmemişse **kaydın açıldığı güne** göre sayılır
  (analiz ekranında kaç gidişin böyle sayıldığı yazar).
- İşlem geçmişi sınırsız tutulur; çok yıllar sonra arşivleme gerekebilir.
- Yönetici geçici parola verir (e-posta ile parola sıfırlama bağlantısı için Supabase'de SMTP ayarı gerekir; ilk sürümde kullanılmadı).
- Grafikler basit çubuklardır; her grafiğin tablo görünümü vardır.
- Para birimi yalnızca TL.
- Klinik şifresiyle girenler için işlem geçmişi kişiyi değil, ortak girişi (personel / yönetici) gösterir.
- Genel yöneticinin bir kliniğe erişimi kapatması, o klinikte açık olan oturumları bir sonraki istekte kapatır; veriler silinmez.

### Kod yapısı

```
db/migrations/        SQL şema ve başlangıç listeleri (kendini schema_migrations'a yazar)
scripts/              migrate.ts, seed-demo.ts (yalnız yerel), start-local-test.sh
src/server/           db (pg / PGlite), auth (Supabase / deneme), permissions, audit, http
src/server/services/  devices, faults (arıza + servis), staff, lookups, users, analytics, export
src/app/(app)/        oturum gerektiren sayfalar;  src/app/api/  JSON uç noktaları
src/components/       formlar (taslak koruma, alan hataları), listeler, grafikler
src/lib/              ortak kurallar: tarih, tutar, Türkçe karşılaştırma, durum hesapları
tests/                birim + entegrasyon (kabul senaryoları);  e2e/  Playwright
```
