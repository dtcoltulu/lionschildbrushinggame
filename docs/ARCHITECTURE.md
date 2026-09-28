# Mimari

## Akış

```
QR ──► /oyun (statik sayfa) ──► Landing ──► Öğretici (ilk kez; atlanabilir) ──► 4 aşama ──► Ödül ──► Tekrar Oyna
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

`session_start_time` = `sessions.first_seen_at`; `game_duration`/`completion_time` = `durationMs`.

## Veri modeli

`supabase/migrations/0001_init.sql`: `sessions (id, campaign_id) PK`, `events (id PK, session_id+campaign_id FK, name CHECK, occurred_at, received_at, play_id, play_index, duration_ms, phase)`. RLS açık, policy yok, anon/authenticated yetkileri kaldırılmış. Serbest metin/JSON alanı yoktur: kişisel veri yazmayı yapısal olarak zorlaştırır.

## Tasarım kararları

- **KPI hesabı SQL yerine TypeScript'te.** Bir kampanya birkaç bin satırdır; tüm olaylar sayfalanarak okunup tek bir saf fonksiyonla hesaplanır. Böylece panel, rapor, CSV ve testler aynı mantığı paylaşır (SQL + TS çifte mantığı sapma riski taşırdı). Hacim on binleri aşarsa SQL görünümlerine taşınabilir.
- **Tarayıcı veritabanına bağlanmaz.** Supabase SDK istemci paketinde yok; anahtar sızıntısı yüzeyi sıfır.
- **Canvas, yama tabanlı temizleme** (piksel maskesi yok): hızlı, deterministik, test edilebilir; çocuk takılırsa ipucu → kolaylaştırma → "Yardım".
- **`test-deneme` kampanyası:** prova ve simülasyon, gerçek istatistikleri kirletmez.
- **Framework taban maliyeti:** ~150 KB gzip JS'in ~115 KB'ı React + Next çalışma zamanıdır; uygulama kodu ~15 KB. Daha fazla parçalamanın kazancı yok, riski var (yavaş ağda "Başla"ya basınca parça gelmemesi).
- **CSP:** dış kaynak yok; Next'in satır içi başlatma betikleri için `script-src 'unsafe-inline'` gerekir (nonce, statik sayfaları dinamik yapıp önbelleği bozardı).

## Güvenlik

- Admin: parola sabit-süreli karşılaştırma, hatalı girişte gecikme + genel sınırlama (IP saklanmaz), çerez `httpOnly; SameSite=Strict; Secure`(üretimde), 12 saat. `ADMIN_*` tanımlı değilse admin tamamen kapalı.
- `/api/events`: gövde ≤ 16 KB, ≤ 20 olay, UUID/enum/aralık doğrulama, kampanya allowlist. Anonim uç nokta olduğu için sahte olay basılması **tamamen engellenemez**; etkisi sınırlıdır (yalnızca sayaçlar).
- Tüm sayfalar `noindex`; güvenlik başlıkları `next.config.ts` içinde.

## Bilinen risk ve sınırlar

Ayrıntı için README "Bilinen sınırlar" ve DEPLOYMENT "Kalıcı alan adı" bölümlerine bakın. En önemlisi: **basılı QR'ın adresi kalıcı olmalı.**
