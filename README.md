# 118-Y Lions – Diş Kahramanı Ol! 🦷

Çocuklar için ağız ve diş sağlığı farkındalık oyunu. **QR → oyun → öğrenme → tamamlama → ödül** akışıyla, saha etkinliklerinde (ör. 11 Ekim Dünya Lions Hizmet Günü, Özgürlük Parkı) kullanılmak üzere hazırlanmıştır.

- Üyelik, isim, telefon, e-posta **yok**. Reklam ve üçüncü taraf takip aracı **yok**.
- Telefon öncelikli, 45–90 saniyelik oyun; kaybetme ve skor yarışı yok.
- Oyun akışı (6 aşama, 24 diş: üst çene 12 + alt çene 12): dış yüzeyler (çikolata, cips, plak, mikrop) → diş araları ve diş eti kenarı ("Detaylı temizle!") → iç yüzeyler ("Bitmedi!") → çiğneme yüzeyleri → dil → diş ipi. Aşamalar `src/game/layout.ts` içinde tanımlıdır. Her aşama bitince neşeli "yu-up-pi" sesi çalar; diş araları bitince yüz dönerek iç yüzeye geçilir.
- Anonim analytics + yönetici paneli + CSV / yazdırılabilir rapor + QR üretici.
- Etkinlik bilgileri konfigürasyondan değişir; başka Lions etkinliklerinde yeniden kullanılabilir.

> Belgeler: [DEPLOYMENT.md](DEPLOYMENT.md) · [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) · [EVENT_DAY_CHECKLIST.md](EVENT_DAY_CHECKLIST.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Hızlı başlangıç (yerel)

Gereksinim: Node.js 20+ (22 önerilir).

```bash
npm install
cp .env.example .env.local      # değerleri doldurun (aşağıya bakın)
npm run dev                     # http://localhost:3000  → /oyun'a yönlenir
```

Supabase kurmadan da çalışır: geliştirme modunda olaylar **bellek içi** depoya yazılır (sunucu yeniden başlayınca silinir). Yönetici paneli için `.env.local` içine şunları yazın:

```
ADMIN_PASSWORD=en-az-12-karakterlik-bir-parola
ADMIN_SESSION_SECRET=en-az-32-karakterlik-rastgele-bir-dizi   # openssl rand -hex 32
```

Sonra <http://localhost:3000/admin> adresinden giriş yapın. Örnek veri için (yalnızca `test-deneme` kampanyasına yazar):

```bash
npm run simulate -- --base=http://localhost:3000 --kids=300
# panelde: /admin?k=test-deneme
```

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Üretim derlemesi / sunucusu |
| `npm run lint` · `npm run typecheck` | Kod kalitesi |
| `npm test` | Birim testleri (Vitest) |
| `npm run test:e2e` | Uçtan uca testler (Playwright, önce `npm run build`) |
| `npm run simulate -- --base=… --kids=…` | Yük/prova simülasyonu (`test-deneme` kampanyası) |

## Ortam değişkenleri

| Değişken | Gizli mi? | Açıklama |
|---|---|---|
| `NEXT_PUBLIC_DEFAULT_CAMPAIGN` | hayır | Varsayılan kampanya (`src/config/campaigns.ts` içindeki `campaignId`) |
| `NEXT_PUBLIC_SITE_URL` | hayır | Kalıcı, kısa alan adı (QR sayfasında varsayılan adres). Örn. `https://dis.lions118y.org` |
| `SUPABASE_URL` | evet (sunucu) | Supabase proje adresi |
| `SUPABASE_SERVICE_ROLE_KEY` | **evet (sunucu)** | Service-role / secret anahtar. **Asla** `NEXT_PUBLIC_` ile başlatmayın |
| `ADMIN_PASSWORD` | evet (sunucu) | Yönetici parolası, ≥ 12 karakter |
| `ADMIN_SESSION_SECRET` | evet (sunucu) | Oturum imza anahtarı, ≥ 32 karakter |
| `ALLOW_MEMORY_STORE` | — | Yalnızca test için: üretim modunda bellek içi depoyu açar (**canlıda kullanmayın**) |

## Etkinlik bilgilerini değiştirme

`src/config/campaigns.ts` dosyasında her etkinlik bir kayıttır:

```ts
{ campaignId, eventName, eventDate, eventDateLabel, eventLocation, organization,
  district, committee, reportTitle, reportSubtitle, timezone, rewardLine, logoPath, active }
```

- Yeni etkinlik: yeni bir kayıt ekleyin, `NEXT_PUBLIC_DEFAULT_CAMPAIGN` değerini ona çevirin (veya QR'ı `…/oyun?k=<campaignId>` ile üretin), yeniden yayınlayın.
- **`campaignId` yayına çıktıktan sonra değiştirilmemelidir** (analytics bu kimlikle raporlanır).
- Tüm çocuğa dönük metinler `src/content/tr.ts` içindedir.
- Analytics ve rapor `campaignId` bazındadır; panelde kampanya seçilir.
- `test-deneme` kampanyası prova içindir: gerçek istatistikleri kirletmez.

## Lions logosu

Lions logosu `public/assets/` altındadır: `lions-logo.png` (arayüz için hafif, 112 px) ve `lions-logo-hd.png` (QR ortası için, 423×400 px). İkisi de şeffaf arka planlıdır. Logoyu değiştirmek için aynı adlarla üzerine yazın ya da `src/config/campaigns.ts` içinde `logoPath` / `qrLogoPath` değerlerini güncelleyin. Logo dosyası bulunamazsa sayfa bozulmaz, yazılı "118-Y" rozeti görünür. Logo giriş ve ödül ekranlarında (beyaz zemin üzerinde), QR'ın ortasında ve (isteğe bağlı) baskıda kullanılır. **Lions markasının kullanımı Lions Clubs International kurallarına tabidir; logoyu değiştirmeden, oranını bozmadan kullanın ve etkinlikten önce bölge yönetiminden onay alın.**

## Yönetici paneli, rapor, QR

| Adres | İçerik |
|---|---|
| `/admin` | Özet kartları, **tarih aralığı filtresi**, saatlik grafik (+ tablo), "Sence yeterli ve etkin temizlendi mi?" cevapları, aşama süreleri, son olaylar |
| `/admin/report` | Yazdırılabilir rapor + CSV indirme ("Etkinlik Raporu Oluştur"); panelde seçili tarih aralığını taşır |
| `/api/admin/export?type=report\|events` | CSV (UTF-8 BOM, `;` ayraçlı: Türkçe Excel'de doğrudan açılır); isteğe bağlı `&from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `/qr` | QR üretici (SVG + PNG 2048/4096 px, ortada logo, hata düzeltme H) |

Bu adreslerin hepsi giriş gerektirir. Giriş yapmamış ziyaretçiler `/admin/login`'e yönlendirilir.

## Ölçümler (KPI) nasıl hesaplanır

| Gösterge | Tanım |
|---|---|
| QR Landing | `landing_view` gönderen **benzersiz tarayıcı** (yanında toplam görüntüleme) |
| Oyunu Başlatan | `game_started` gönderen benzersiz tarayıcı (**yalnızca ilk oyun**) |
| Başlatma oranı | Oyunu Başlatan ÷ QR Landing (en çok %100): QR'ı okutanların kaçı oyuna başlıyor. Test açılışları ve sayfayı açıp çıkanlar bu oranı düşürür |
| Tamamlayan | En az bir kez `game_completed` gönderen benzersiz tarayıcı |
| Tamamlama | Tamamlayan ÷ Başlatan |
| Ortalama / medyan süre | Yalnızca **ilk oyunların** süresi; 15 dakikadan uzun olanlar dışlanır; sekme arka plandayken süre işlemez |
| Tekrar oynama | `replay_started` sayısı (yeni oyuncu sayılmaz) |
| Toplam başarılı tamamlanma | Tüm `game_completed` sayısı (tekrarlar dahil) → dağıtılan diş macunuyla kıyaslayın |
| Saatlik kullanım | Başlatılan tüm oyunlar (ilk + tekrar), kampanya saat diliminde (Europe/Istanbul) |

**Tarih aralığı:** Panelde (rapor ve CSV de aynı aralığı kullanır) **ilk gün – son gün** seçilebilir; günler kampanya saat dilimine (İstanbul) göre, uçlar dahildir (örn. `/admin?from=2026-10-11&to=2026-10-11`). Süzgeç yalnızca görünen sayıları sınırlar, **veri silinmez**; etkinlik gününü, ondan önceki deneme oyunlarından ayırmak için kullanın. Boş bırakılırsa tüm dönem gösterilir.

⚠️ **"Benzersiz" sayılar yaklaşıktır**: kimlik tarayıcıda saklanan rastgele koddur. Aynı telefonu paylaşan kardeşler tek kişi, tarayıcı verisini silen ya da gizli sekme kullanan kişi birden fazla sayılabilir. Bu, kişisel veri toplamadan ölçüm yapmanın doğal bedelidir.

## Soru ve klinik fırsatı (kampanya ayarları)

Özellikler `src/config/campaigns.ts` içindeki kampanya ayarlarından açılıp kapatılır. **Soru (`selfCheck`) hem asıl kampanyada (`lions-118y-2026-10-11`, `/oyun`) hem deneme kampanyasında (`/oyun?k=test-deneme`) açıktır.** **Klinik fırsatı kartı (`clinicOffer`) yalnızca deneme kampanyasındadır**: asıl kampanyanın ödül ekranı (diş macunu) eskisi gibidir (e2e testi bunu doğrular).

⚠️ Asıl adreste yapılan denemeler (soru cevapları dahil) **gerçek sayılara girer**: denemeleri `?k=test-deneme` ile yapın. Veri silmeden bir günü/aralığı ayırmak için panelde **tarih filtresi** vardır.

| Ayar | Ne yapar |
|---|---|
| `selfCheck: true` | Aşama 1–5 **bittikten sonra** (sahne tamamen temizken, sonraki aşamaya geçmeden) oyun durur ve **"Sence yeterli ve etkin temizlendi mi?"** sorusu çıkar. **Evet** → "Henüz bitmedi! Sırada diş araları, iç yüzeyler… var." (kalan yüzeyleri sayar), **Hayır** → "Aferin, işi biliyorsun!…" tebriki; ardından oyun sonraki aşamaya geçer. Son aşamada (diş ipi) soru yoktur (her yer gerçekten temiz). Soru süresi oyun süresine sayılmaz. |
| `clinicOffer: {…}` | Ödül ekranında "standdaki görevliye göster / diş macunu" kartı yerine **klinik fırsatı** gösterilir (ör. Koşuyolu Park Diş Kliniği ücretsiz muayene). Etkinlik bitip diş macunu kalmadığında kullanılır. Yalnızca doğrulanmış bilgiyi yazın; randevu/telefon gibi ek satır için `detail`, klinik sitesi için `website` (yalnızca alan adı, ör. `www.kosuyolupark.com`; kartın en altında dokunulabilir bağlantı olur, yeni sekmede açılır, referrer gönderilmez, dokunma kaydedilmez) alanı vardır. |

**Cevapların ölçümü (anonim):** her cevap bir olaydır: `self_check_yes` (çocuk "Evet" dedi = diğer yüzeyler kalmışken "yeterli" dedi, işi erken bırakmak istedi) ya da `self_check_no` ("Hayır" = doğru farkındalık); `phase` = biten aşama (1–5). Panelde (`/admin` ve `/admin?k=test-deneme`) **Evet / Hayır sayısı ve oranı**, aşama bazlı döküm, "en az bir kez Evet diyen çocuk" görünür; yazdırılabilir raporda ve CSV'de de yer alır. Oranlar cevap sayısı üzerindendir (bir çocuk her aşamada bir kez cevaplar). Çocuk bazlı ve koruma göstergeleri:

| Soru göstergesi | Tanım |
|---|---|
| **Başlangıç yanılgısı** | Çocuğun (tarayıcının) kaydedilen **ilk** cevabı "Evet" olanların oranı. İlk cevap henüz hiçbir geri bildirim görülmeden verildiği için en temiz ölçüdür; sonraki cevaplar "doğru cevabı öğrenme"den etkilenir. Tek cümlelik bulgu: "Çocukların %X'i dış yüzeyi temizleyince 'bitti' dedi." |
| İlk oyunda / tekrar oyunlarda "Evet" oranı | `playIndex` 1 ile ≥ 2 ayrımı. Tekrarlarda oran düşüyorsa oyun öğretiyor olabilir (ya da çocuk doğru cevabı öğrenmiştir). |
| Soruların eklediği süre | Tamamlanan ve en az bir cevabı olan oyunlar için (soru dahil gerçek süre − aktif oyun süresi) **medyanı**. "Ortalama süre" soru süresini saymadığı için bu, sorunun oyunu ne kadar uzattığını gösteren koruma göstergesidir; tamamlama oranı belirgin düşerse soruyu kısaltın. |

Bunlar bilgi/tutum göstergeleridir, gerçek fırçalama başarısı değil. Yüzdeler için aşama başına yaklaşık 100 çocuk gerekir (hata payı ±%10; ±%5 için yaklaşık 400); az sayıda çocukla yüzdeleri değil sayıları okuyun.

⚠️ Yeni olay adları veritabanında `supabase/migrations/0002_self_check_events.sql` ile izin verilir. **Yeni sürümü yayına almadan önce bu geçiş uygulanmalıdır** (bkz. `DEPLOYMENT.md`). Canlı veritabanında 13.10.2026'da uygulandı; yeni bir veritabanı kurulursa 0001'den sonra çalıştırın. Uygulanmamışken soru açıksa cevap içeren olay grupları veritabanı tarafından reddedilir (cihaz bekletip tekrar dener, kayıp olmaz; ama arkasındaki olaylar da bekler).

## Gizlilik özeti

- Toplanan: rastgele oturum UUID'si, olay adı, saat, oyun süresi, aşama numarası, kaba cihaz sınıfı (mobil/tablet/masaüstü). "Sence yeterli ve etkin temizlendi mi?" sorusunun Evet/Hayır cevabı da bir olay adı olarak (aşama numarasıyla, kimliksiz) tutulur; `/gizlilik` sayfasında belirtilmiştir.
- Toplanmayan: isim, doğum tarihi, telefon, e-posta, fotoğraf, konum, sosyal medya, IP, user-agent metni, parmak izi.
- Sunucu istekteki bilinmeyen alanları atar; olay adları, sayı aralıkları ve kampanya kimliği katı doğrulanır.
- Veritabanında RLS açık ve hiç policy yok; tarayıcı veritabanına **hiç bağlanmaz** (yalnızca `/api/events`'e konuşur).
- Hosting sağlayıcısı (ör. Vercel) teknik günlüklerinde bağlantı bilgisini geçici tutabilir; uygulama bunu saklamaz. Bu durum `/gizlilik` sayfasında belirtilmiştir. Kurumunuzun KVKK aydınlatma gereksinimleri için hukuk danışmanınıza danışın.

## Dayanıklılık (yavaş / kopan internet)

- Sayfa ve oyun kodu toplam ~150 KB (gzip); resim, video, yazı tipi, harici kütüphane yok. Sesler kod ile üretilir (dosya yok).
- Service worker, ilk yüklemeden sonra oyunu önbelleğe alır: bağlantı kopsa da sayfa açılır ve oyun oynanır. **İlk ziyaret internet gerektirir.**
- Analytics olayları önce cihazdaki kalıcı kuyruğa yazılır; ağ gelince (üstel geri çekilmeyle) gönderilir; tekrar gönderim çift kayıt oluşturmaz.
- Saat sapması: telefonun saati yanlış olsa bile sunucu olay zamanlarını düzeltir.

## Klasör yapısı

```
src/app/            sayfalar ve API (oyun, admin, qr, api/events, api/admin/*)
src/components/     brand/ game/ admin/ ui/
src/game/           saf TS oyun motoru (React'siz): engine, brush, layout, render, audio
src/analytics/      istemci kuyruğu + sunucu doğrulaması
src/lib/            auth, kpi, csv, qr, depo (Supabase / bellek)
src/config/         campaigns.ts (etkinlik konfigürasyonu)
src/content/        tr.ts (metinler)
supabase/migrations SQL şeması
public/             sw.js, manifest, assets/ (logo)
tests/ e2e/         birim ve uçtan uca testler
scripts/            simulate-traffic.mjs
```

## Bilinen sınırlar

- iOS Safari'de gerçek cihaz testi bu depo içinde otomatikleştirilemez; etkinlikten önce [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) içindeki el ile testleri yapın.
- Oyun süresi (45–90 sn) gerçek çocuklarla ayarlanmalıdır; ayarlar `src/game/constants.ts` içinde tek yerdedir.
- Bir tarayıcıda "ilk oyun" bilgisi saklanır; aynı telefondan farklı bir çocuk oynarsa "tekrar oynama" sayılır.
