# Yayına Alma (Supabase + Vercel)

Tahmini süre: 30–45 dakika. **Etkinlikten en az 1 hafta önce** yapın; kalan zamanı testlere ayırın.

## 0. Önce karar: kalıcı, kısa alan adı

QR kod baskıya girdikten sonra **değiştirilemez**. Bu yüzden:

1. Lions'un kontrolünde, kısa ve kalıcı bir alan adı/alt alan adı belirleyin (ör. `dis.lions118y.org` veya `lions118y.org/oyun`).
2. QR'ı **Vercel'in geçici `*.vercel.app` adresiyle basmayın**. Alan adı Lions'ta kalırsa ileride altyapıyı değiştirseniz de basılı QR çalışır.
3. Adres ne kadar kısaysa QR o kadar seyrek ve okunaklı olur.

## 1. Supabase kurulumu

1. <https://supabase.com> → **New project**. Bölge: `Central EU (Frankfurt)` (İstanbul'a yakın). Güçlü bir veritabanı parolası belirleyin ve saklayın.
2. Proje hazır olunca **SQL Editor → New query**: `supabase/migrations/0001_init.sql` dosyasının **tamamını** yapıştırıp **Run** deyin. "Success" görmelisiniz.
3. **Table Editor**'da `sessions` ve `events` tablolarını görün. Her ikisinde **RLS enabled** yazmalı (SQL bunu açar; **policy eklemeyin**).
4. **Project Settings → API** sayfasından iki değeri alın:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** anahtarı (yeni arayüzde "secret key", `sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ Bu anahtar veritabanına tam erişim verir. Sadece Vercel ortam değişkenine yazın; koda, sohbete, e-postaya koymayın. `anon`/`publishable` anahtarı bu projede **kullanılmaz**.

## 2. Yönetici parolası ve oturum anahtarı

```bash
openssl rand -base64 18    # → ADMIN_PASSWORD  (≥ 12 karakter; not alın, ekiple güvenli paylaşın)
openssl rand -hex 32       # → ADMIN_SESSION_SECRET (≥ 32 karakter)
```

## 3. Vercel'e yayınlama

1. <https://vercel.com> → **Add New → Project** → bu GitHub deposunu içe aktarın (Framework: Next.js, otomatik algılanır).
2. **Environment Variables** (Production için):

   | Ad | Değer |
   |---|---|
   | `NEXT_PUBLIC_DEFAULT_CAMPAIGN` | `lions-118y-2026-10-11` |
   | `NEXT_PUBLIC_SITE_URL` | `https://dis.lions118y.org` (kendi alan adınız, sonda `/` yok) |
   | `SUPABASE_URL` | Adım 1'deki Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Adım 1'deki secret/service_role anahtarı |
   | `ADMIN_PASSWORD` | Adım 2 |
   | `ADMIN_SESSION_SECRET` | Adım 2 |

   `ALLOW_MEMORY_STORE` **eklemeyin**.
3. **Deploy**. Fonksiyon bölgesi `vercel.json` ile `fra1` (Frankfurt) seçilidir (Supabase ile aynı bölge).
4. **Settings → Domains** bölümünden alan adınızı ekleyin ve DNS kaydını yönlendirin. HTTPS otomatiktir.
5. `NEXT_PUBLIC_*` değişkenleri **derleme sırasında** gömülür: bunları değiştirirseniz **yeniden deploy** edin.

> Vercel Hobby (ücretsiz) plan ticari olmayan kullanım içindir; Lions gibi bir dernek için uygun olabilir ancak kullanım şartlarını kontrol edin. Beklenen yük (birkaç yüz çocuk) her iki servisin ücretsiz katmanının çok altındadır.

## 4. Yayın sonrası doğrulama (10 dakika)

```bash
BASE=https://dis.lions118y.org

# 1) Oyun açılıyor mu?
curl -sI $BASE/oyun | head -1                     # HTTP/2 200

# 2) Admin korumalı mı? (401 veya /admin/login'e yönlendirme beklenir)
curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/admin/export     # 401

# 3) Veri deposu bağlı mı? Deneme kampanyasına anonim bir olay yazın:
npm run simulate -- --base=$BASE --kids=20      # "hata yok ✔" beklenir
```

Ardından `$BASE/admin` adresinden giriş yapın, üstten **"Deneme (Test)"** kampanyasını seçin: 20 çocuğun sayıları görünmelidir. Supabase **Table Editor → events** tablosunda satırları görün.

Sonra telefonda `$BASE/oyun?k=test-deneme` adresini açıp bir oyun oynayın (gerçek kampanya istatistiklerini kirletmez), panelde sayıların arttığını doğrulayın. Test bitince gerçek kampanyanın sayılarının **sıfır** olduğunu kontrol edin.

## 5. QR kodu oluşturma

1. `$BASE/qr` → giriş yapın.
2. Adres kutusunun `https://dis.lions118y.org/oyun` olduğunu doğrulayın (kısa ve ek parametresiz olması iyidir; varsayılan kampanya için `?k=` eklenmez).
3. **SVG** (matbaa/afiş için önerilir) ve **PNG** (2048 px: A5–A4, 4096 px: büyük afiş) indirin. Ortadaki logo hata düzeltme **H** ile güvenlidir; logo dosyanız yoksa "logo yerleştir" kutusunu kapatın.
4. **Baskıdan önce** en az 2 iPhone + 2 Android telefonla, farklı ışıkta okutun. Beyaz zemin, siyah kod, en az 3×3 cm (stant için 10×10 cm ve üzeri).

## 6. Rapor alma

- `/admin` → **Etkinlik Raporu Oluştur** → sayfada **Yazdır / PDF olarak kaydet** ve **CSV indir**.
- Ham olaylar: panelde "Ham olayları CSV indir".
- CSV Türkçe Excel'de çift tıklayarak açılır (UTF-8 BOM + `;`). Google E-Tablolar'da "Dosya → İçe aktar" ile ayırıcıyı `;` seçin.

## 7. Yeni etkinlik için yeniden kullanım

1. `src/config/campaigns.ts` içine yeni bir kayıt ekleyin (yeni, benzersiz `campaignId`).
2. `NEXT_PUBLIC_DEFAULT_CAMPAIGN` değerini yeni kayda çevirin **veya** varsayılanı değiştirmeden QR'ı `…/oyun?k=<campaignId>` ile üretin.
3. Push edin (Vercel otomatik yayınlar). Eski etkinliğin verisi silinmez; panelde kampanya seçilerek görülür.

## 8. Etkinlik sonrası

- Raporları (PDF + CSV) arşivleyin.
- Verileri silmek isterseniz: Supabase SQL Editor'de `supabase/purge.sql` içindeki komutu kampanya kimliğinizle çalıştırın.
- Yönetici parolasını değiştirmek için Vercel'de `ADMIN_PASSWORD` ve `ADMIN_SESSION_SECRET` değerlerini yenileyip yeniden deploy edin (açık oturumlar geçersiz olur).

## Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| Panelde "Veri deposu yapılandırılmamış" | `SUPABASE_URL` veya `SUPABASE_SERVICE_ROLE_KEY` eksik; değişkenleri ekleyip yeniden deploy edin |
| Panelde "Veriler okunamadı" | Anahtar/URL yanlış ya da SQL çalıştırılmamış (tablolar yok) |
| `/api/events` 503 döner | Aynı neden. İstemciler olayları kuyrukta tutar; düzelince gönderirler (veri kaybı olmaz) |
| Giriş sayfası "yapılandırılmamış" diyor | `ADMIN_PASSWORD` (≥ 12) ve `ADMIN_SESSION_SECRET` (≥ 32 karakter) gerekli |
| "Çok fazla hatalı deneme" | 5 dakika bekleyin |
| Eski sürüm görünüyor | Service worker önbelleği: sayfayı iki kez yenileyin. Yeni sürümde dosya adları değiştiği için otomatik güncellenir |
