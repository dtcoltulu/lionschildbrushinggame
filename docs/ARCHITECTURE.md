# Mimari

## Akış

```
QR ──► /oyun (statik sayfa) ──► Landing ──► Öğretici (ilk kez; atlanabilir) ──► 6 aşama ──► Ödül ──► Tekrar Oyna
                  │                                  │                                      │
                  └──────── analytics olayları ──────┴──► yerel kuyruk (localStorage) ──► POST /api/events ──► Supabase
                                                                                                               ▲
/admin, /admin/report, /qr, /api/admin/export  ◄── giriş (imzalı çerez) ───────────── sunucu okur (service role) ┘
```

## Katmanlar

| Katman | Yer | Not |
|---|---|---|
| Oyun motoru | `src/game/*` | React'siz, deterministik, test edilir. Yama (patch) tabanlı temizleme; swipe = yön değiştirme veya uzun hareket |
| Oyun UI | `src/components/game/*` | Canvas 2D (kütüphanesiz), DPR ≤ 2, `touch-action:none`, pointer events |
| Çizim | `src/game/render.ts`, `layout.ts`, `shade.ts`, `teeth.ts`, `toothsprite.ts`, `occlusal.ts`, `gums.ts`, `draw.ts` | **Yerleşim** (`layout.ts`): ön dişler gülüş tasarımı (altın oran) oranlarıyla kurulur: merkezden dışa genişlik 1 : 0.78 : 0.71 : 0.62 : 0.54 : 0.49, merkez kesici genişlik/boy ≈ 0.75, gülüş kavisi, alt dişler ≈ %75 dar; `tests/layout.test.ts` bu oranları korur. **Gerçekçi görünüm** (yalnızca görünüm; vuruş alanları ve yamalar `layout.ts` dikdörtgenleridir): dişler, çiğneme yüzeyleri (tümsek, oluk, çukur), diş eti (yuvarlak kenar, papilla, ince doku), damak kıvrımları ve dil papillaları **yükseklik haritasından ışık hesabıyla** (`shade.ts`: eğimden normal, sol üstten Blinn-Phong, ortam örtülmesi, sıcak gölge tonu) üretilen sprite'lar olarak çizilir; silüet ve kenar yumuşatmasını tarayıcı yapar (`destination-in`). Sprite hesabı yalnızca yazma yolunu kullanır (`putImageData`), tuvalden geri okuma yoktur. Hesap ağır olduğundan öğretici/ilk aşamalarda kareler arasında az az önceden yapılır (`renderFrame` → `warmArt`); gerekirse ilk kullanımda anında hesaplanır. Sprite üretilemezse (tuval/belge yok) basit degrade çizime düşülür. Sahne (yüz, ağız, dişler) oyun boyunca değişmediği için `render.ts` bir kez ayrı bir tuvale çizip her karede tek `drawImage` ile basar (ekran boyutu/aşama türü değişince yeniden kurulur) |
| Analytics istemci | `src/analytics/client.ts` | Kalıcı kuyruk, üstel geri çekilme, idempotent olay kimlikleri |
| Analytics sunucu | `src/analytics/server/validate.ts`, `src/app/api/events` | Katı doğrulama, bilinmeyen alanlar atılır, saat sapması düzeltmesi |
| Depo | `src/lib/store.ts`, `supabase-store.ts`, `get-store.ts` | `EventStore` arayüzü: Supabase (üretim) / bellek (geliştirme) |
| KPI | `src/lib/kpi.ts` | **Tek yerde**, saf fonksiyon: panel, rapor ve CSV aynı hesaptan beslenir |
| Admin | `src/proxy.ts`, `src/lib/auth.ts`, `src/lib/admin-guard.ts` | Parola → HMAC imzalı httpOnly çerez (12 saat); proxy + sayfa/route içinde çift kontrol |
| QR | `src/lib/qr.ts`, `components/admin/QrTool.tsx` | Hata düzeltme H, sessiz bölge 4 modül, logo ≤ %22 genişlik |
| Çevrimdışı | `public/sw.js` | Statik: önce önbellek; sayfa: ağ (3 sn) → önbellek; `/api`, `/admin`, `/qr` asla |

## Olay modeli

Kimlikler: `sessionId` (tarayıcı başına rastgele UUID, localStorage), `playId` (deneme başına), `event.id` (istemci üretir; sunucu `ON CONFLICT DO NOTHING`).

| Olay | Ne zaman |
|---|---|
| `landing_view` | Sayfa yüklenince |
| `tutorial_started` / `tutorial_completed` / `tutorial_skipped` | Öğretici |
| `game_started` | Bu kampanyada **ilk** oyun (`playIndex=1`) |
| `replay_started` | `playIndex ≥ 2` (bu durumda `game_started` **gönderilmez**) |
| `phase_completed` | Her aşama bitince (`phase` 1–4, `durationMs`) |
| `game_completed` | Her tamamlamada (`playIndex`, `durationMs` = aktif oyun süresi) |
| `reward_screen_viewed` | Ödül ekranı açılınca |
| `self_check_yes` / `self_check_no` | Yalnızca `selfCheck` açık kampanyada (asıl ve deneme): "Sence yeterli ve etkin temizlendi mi?" cevabı; `phase` 1–5 (sorunun sorulduğu aşama). Evet = aşama bitince, diğer yüzeyler kalmışken "yeterli" dedi; Hayır = doğru farkındalık |

`session_start_time` = `sessions.first_seen_at`; `game_duration`/`completion_time` = `durationMs`.

## Veri modeli

`supabase/migrations/0001_init.sql` (+ `0002_self_check_events.sql`: ad listesine `self_check_yes/no`; `tests/migrations.test.ts` listenin uygulamadaki `EVENT_NAMES` ile birebir aynı kalmasını zorunlu kılar): `sessions (id, campaign_id) PK`, `events (id PK, session_id+campaign_id FK, name CHECK, occurred_at, received_at, play_id, play_index, duration_ms, phase)`. RLS açık, policy yok, anon/authenticated yetkileri kaldırılmış. Serbest metin/JSON alanı yoktur: kişisel veri yazmayı yapısal olarak zorlaştırır.

## Tasarım kararları

- **KPI hesabı SQL yerine TypeScript'te.** Bir kampanya birkaç bin satırdır; tüm olaylar sayfalanarak okunup tek bir saf fonksiyonla hesaplanır. Böylece panel, rapor, CSV ve testler aynı mantığı paylaşır (SQL + TS çifte mantığı sapma riski taşırdı). Hacim on binleri aşarsa SQL görünümlerine taşınabilir.
- **Tarih aralığı süzgeci de saf fonksiyon** (`src/lib/range.ts`): panel, rapor ve CSV önce olayları kampanya saat diliminde yerel güne göre süzer (uçlar dahil; oturumlar yalnızca aralıkta olayı olanlarla kalır), sonra aynı `computeKpis`'i çalıştırır. Veri silinmez; kalıcı hizmetteki test oyunlarını etkinlik gününden ayırmanın yolu budur.
- **Soru süresi oyun süresine sayılmaz** (motor "asking" durumunda sayaç durur), bu yüzden "Ortalama süre" sorunun oyunu ne kadar uzattığını göstermez. Koruma göstergesi olarak aynı `playId`'li olaylardan (soru dahil gerçek süre − aktif süre) medyanı hesaplanır; yeni olay ya da sütun gerekmez.
- **Tarayıcı veritabanına bağlanmaz.** Supabase SDK istemci paketinde yok; anahtar sızıntısı yüzeyi sıfır.
- **Canvas, yama tabanlı temizleme** (piksel maskesi yok): hızlı, deterministik, test edilebilir; çocuk takılırsa ipucu → kolaylaştırma → "Yardım".
- **Gerçekçi diş sprite'ları:** el çizimi degrade yığınları "plastik" duruyordu; hacim, ışık ve parlama için yükseklik haritası + eğimden aydınlatma kullanılır (tek dosyalık küçük bir motor, kütüphane yok). Sprite'lar cihaz ölçeğine yakın çözünürlükte (1.5–3 piksel/birim) üretilir; ölçüm (yazılım çizimli Chromium): bir azı dişi ≈ 5–15 ms, 24 ön diş ≈ 130 ms, hepsi arka planda kareler arasında hazırlanır.
- **Sahne önbelleği:** zengin diş çizimi (degrade, gölge) her karede yeniden çizilseydi eski telefonlarda kare süresini ikiye katlardı. Önbellek açıkken kare başına maliyet eski çizimden de düşüktür (ölçüm: yazılım çizimli Chromium'da ≈ 4,5 ms; önceki çizim ≈ 8,5 ms, önbelleksiz yeni çizim ≈ 15 ms). Normal karelerde önbellek tam piksel hizasında basılır (doğrudan çizimle piksel piksel aynı); ağız açılma geçişinde (diş araları → iç yüzey) sahne önbellekten değil doğrudan çizilir (çene her karede başka bir yerde olduğu için önbelleğe alınamaz); geçişin sonuna doğru iç yüzey sahnesi önbelleğe alınır, oynanış bu önbellekten başlar.
- **Açık ağız (iç yüzey aşaması):** Diş araları bitince yüz dönmez; çene `JAW_DROP` (84 birim) kadar iner ve ağız kocaman açılır. Üst sıra yerinde kalır; alt dişler, alt diş eti, alt dudak ve dil çeneyle birlikte iner (`layout.ts`: `INNER_LOWER_TEETH`, `MOUTH_OPEN`). `render.ts` içindeki `drawOpenMouth(ctx, açıklık, karışım)` hem geçiş karelerini hem de statik iç yüzey sahnesini çizer (açıklık 1, karışım 1); bu yüzden geçişin son karesi ile oynanışın ilk karesi birebir aynıdır. Dişler ve diş eti için yeni sprite hesabı yoktur: ön ve iç yüz sprite'ları yeniden kullanılır, alt sıra yalnızca öteleme ile kaydırılır. Ağız boşluğu (boğaz, bademcikler, küçük dil) vektör çizimdir ve çene indikçe belirir; çene kapalıyken görünmediği için geçişin ilk karesi diş araları sahnesiyle piksel piksel aynıdır. `engine.ts`: `jawOpening` ve `artBlend` eğrileri; geçişin `OPEN_FROM`–`OPEN_TO` (%10–%50) aralığında çene iner, `OPEN_TO`'da sahne (lekeler) değişir ve lekeler kısa sürede belirir (`OPEN_APPEAR`). `onOpen` (ses) çene inmeye başlarken, `onPhaseStart` sahne değişince çağrılır. Ses: süzülen "vınn"; çene tam inince cihazda yerel Türkçe ses varsa "Aaa de!" denir (sentez ünlü taklidi kullanılmaz: düşük perdeli testere dalgası kaba bir ses çıkarıyordu). Hareketi azalt ayarında animasyon çizilmez; sahne çene zamanında doğrudan değişir.
- **`test-deneme` kampanyası:** prova ve simülasyon, gerçek istatistikleri kirletmez.
- **Framework taban maliyeti:** ~150 KB gzip JS'in ~115 KB'ı React + Next çalışma zamanıdır; uygulama kodu ~15 KB. Daha fazla parçalamanın kazancı yok, riski var (yavaş ağda "Başla"ya basınca parça gelmemesi).
- **CSP:** dış kaynak yok; Next'in satır içi başlatma betikleri için `script-src 'unsafe-inline'` gerekir (nonce, statik sayfaları dinamik yapıp önbelleği bozardı).

## Güvenlik

- Admin: parola sabit-süreli karşılaştırma, hatalı girişte gecikme + genel sınırlama (IP saklanmaz), çerez `httpOnly; SameSite=Strict; Secure`(üretimde), 12 saat. `ADMIN_*` tanımlı değilse admin tamamen kapalı.
- `/api/events`: gövde ≤ 16 KB, ≤ 20 olay, UUID/enum/aralık doğrulama, kampanya allowlist. Anonim uç nokta olduğu için sahte olay basılması **tamamen engellenemez**; etkisi sınırlıdır (yalnızca sayaçlar).
- Tüm sayfalar `noindex`; güvenlik başlıkları `next.config.ts` içinde.

## Bilinen risk ve sınırlar

Ayrıntı için README "Bilinen sınırlar" ve DEPLOYMENT "Kalıcı alan adı" bölümlerine bakın. En önemlisi: **basılı QR'ın adresi kalıcı olmalı.**
