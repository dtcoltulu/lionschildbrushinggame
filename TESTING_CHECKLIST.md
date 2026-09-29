# Test Kontrol Listesi

## A. Otomatik testler (her değişiklikte, CI'da da çalışır)

```bash
npm run lint && npm run typecheck && npm test      # 60+ birim testi
npm run build && npm run test:e2e                  # uçtan uca (Playwright)
```

Kapsam:

- **Oyun motoru:** swipe algılama, tek dokunuşla temizlenmeme, 6 aşamanın sırayla bitmesi, ilerlemenin monoton artması, yardım/ipucu, arka planda süre şişmemesi.
- **Analytics istemcisi:** çevrimdışı kuyruk, sayfa yenilense de kuyruğun korunması, 503'te tutma / 400'de atma, 20'lik gruplar, depolama kapalıyken çalışma, ilk/tekrar oyun ayrımı.
- **Sunucu:** kampanya/UUID/olay adı doğrulaması, fazladan (kişisel) alanların atılması, saat sapması düzeltmesi, çift gönderimde tek kayıt.
- **KPI:** ziyaret/başlama/tamamlama ayrımı, tamamlama oranı, ilk oyun süresi, İstanbul saatiyle saatlik dağılım, gece yarısı sınırı, boş veri.
- **CSV:** BOM, `;`, Türkçe karakter, formül enjeksiyonu koruması.
- **Yönetici girişi:** doğru/yanlış parola, süre dolumu, kurcalanmış token, yapılandırma yoksa kapalı.
- **QR:** logolu ve logosuz üretilen kod bir çözücüyle **geri okunur**, küçük baskı boyutunda da.
- **E2E:** tam oyun (öğretici → 6 aşama → ödül → tekrar), olay sırası ve gizlilik (gövdede yalnızca izinli alanlar), öğretici atlama, yardım butonu, ses tercihi, **çevrimdışı oyun + kuyruğun internet gelince boşalması**, **service worker ile internetsiz açılış**, **gerçek dokunmatik olaylar**, admin erişim koruması, dashboard/rapor/CSV/QR indirme.

## B. Etkinlikten ÖNCE el ile yapılacak testler

Gerçek cihaz gerektirir; bu depoda otomatikleştirilemez. Test için hep `…/oyun?k=test-deneme` adresini kullanın (gerçek sayıları kirletmez).

### Cihaz / tarayıcı matrisi
| Cihaz | Tarayıcı | Oyun | Ses | Ödül | QR okuma | Not |
|---|---|---|---|---|---|---|
| iPhone (güncel iOS) | Safari | ☐ | ☐ | ☐ | ☐ | |
| iPhone (eski, ~3 yaş) | Safari | ☐ | ☐ | ☐ | ☐ | |
| Android (güncel) | Chrome | ☐ | ☐ | ☐ | ☐ | |
| Android (ucuz/eski) | Chrome | ☐ | ☐ | ☐ | ☐ | performans |
| Android | Samsung Internet | ☐ | ☐ | ☐ | ☐ | |
| Tablet (iPad ya da Android) | Safari/Chrome | ☐ | ☐ | ☐ | ☐ | |
| iPhone/Android kamera uygulaması | – | – | – | – | ☐ | uygulama içi tarayıcıda (WhatsApp/Instagram) açılıyor mu? |

### Oyun deneyimi
- [ ] Sayfa açılınca "Başla" hemen görünüyor, kaydırma gerekmiyor.
- [ ] Öğretici anlaşılıyor; "Atla" çalışıyor.
- [ ] Parmakla ileri-geri fırçalama doğal; fırça parmağı örtmüyor; sayfa kaymıyor, aşağı çekince yenilenmiyor (özellikle iOS Safari).
- [ ] 6 aşama sırayla geliyor (dış yüzey → diş araları → iç yüzey → çiğneme → dil → diş ipi); mesajlar okunuyor; ilerleme çubuğu artıyor.
- [ ] Takılınca ~6 sn'de ipucu çıkıyor; "Yardım" butonu çalışıyor.
- [ ] **Gerçek çocuklarla** (6–14 yaş, en az 5 çocuk, farklı yaşlardan) süre ölçün: hedef 45–90 sn. Çok kısa/uzunsa `src/game/constants.ts` (`SWIPES_PER_PATCH`, aşama sabitleri) ayarlanır.
- [ ] Ekranı dikey/yatay çevirince bozulmuyor (dikey önerilir).
- [ ] Ses: 🔊/🔇 çalışıyor, ilk dokunuştan sonra ses geliyor, sessizde oyun tam anlaşılıyor, sessiz anahtarı (iPhone) açıkken çok rahatsız etmiyor.
- [ ] **Aşama bitince "yu-up-pi!" sesi** (kayan ses + parıltı) geliyor. Bu sesler kodla üretilir; **gerçek telefonda kulakla** dinleyin ve gerekirse `src/game/audio.ts` içindeki `yay` sesini ayarlayın.
- [ ] Telefonda **yerel Türkçe ses** kurulu ise kısa bir övgü ("Yuppi!", "Aferin!" …) de söylenir. Ses yoksa yalnızca efekt çalar. Bulut (çevrim içi) sesler bilerek kullanılmaz; gizlilik için metin dışarı gitmez.
- [ ] **Yüz dönme:** diş araları bitince yüz yana dönüp iç yüzeye ("Bitmedi!") geçiyor; takılma ya da titreme yok.
- [ ] Türkçe karakterler (ç ğ ı İ ö ş ü) her ekranda doğru.
- [ ] Ödül ekranı: "TEBRİKLER! DİŞ KAHRAMANI OLDUN!", görevliye göster, diş macunu, 3 mesaj net; canlı saat akıyor; "Tekrar Oyna" çalışıyor.

### Bağlantı koşulları
- [ ] Telefonu **uçak moduna** alıp oyunu (daha önce bir kez açılmışsa) yeniden açın: açılıyor ve oynanıyor.
- [ ] Oyun ortasında Wi-Fi/mobil veriyi kesin: oyun durmuyor, ödül geliyor; interneti açınca panelde olaylar görünüyor.
- [ ] Chrome DevTools → Network → **Slow 4G** (veya telefonda zayıf çekim): ilk açılış makul sürede.
- [ ] Aynı anda 10+ telefonla oynatın (arkadaş/aile): sayılar panelde tutarlı.
- [ ] `npm run simulate -- --base=<canlı adres> --kids=500 --concurrency=60` → "hata yok ✔" (deneme kampanyasına yazar).

### Analytics doğruluğu
- [ ] Yeni bir tarayıcıyla (gizli sekme) tam oyun: panelde `Landing +1`, `Başlatan +1`, `Tamamlayan +1`.
- [ ] Aynı tarayıcıda "Tekrar Oyna": `Tekrar Oynama +1`, **Başlatan artmadı**.
- [ ] Sayfayı oyun ortasında kapatın: Başlatan +1 ama Tamamlayan artmadı.
- [ ] Saatlik grafikte olay doğru saat kovasında (Türkiye saati).
- [ ] Telefon saatini bilerek 1 saat yanlış ayarlayıp oynayın: olay yine doğru saatte görünür.

### Yönetici paneli
- [ ] Giriş yapmadan `/admin`, `/qr`, `/admin/report`, `/api/admin/export` erişilemiyor.
- [ ] Yanlış parola reddediliyor; doğru parola giriyor; çıkış çalışıyor.
- [ ] Panel telefonda da okunuyor (etkinlik günü telefondan bakacaksınız).
- [ ] "Etkinlik Raporu Oluştur" başlıkları ve sayılar doğru; yazdır/PDF düzgün; CSV Excel'de Türkçe karakterlerle açılıyor.
- [ ] Rapordaki sayılar panelle aynı.

### QR
- [ ] SVG ve PNG indirilebiliyor; ekrandan ve **çıktıdan** okutuluyor (logolu).
- [ ] QR doğrudan `/oyun`'u açıyor, ara sayfa/yönlendirme yok.
- [ ] Farklı mesafe (30–100 cm), gölge/güneş ışığında okuma.

### Erişilebilirlik / performans
- [ ] Lighthouse (mobil, gizli sekme) `…/oyun`: Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 90 (SEO düşük çıkması **beklenen** ve doğrudur: sayfalar bilerek `noindex`). Geliştirme sırasında ölçülen: Performance ~91, Accessibility 100, Best Practices 100.
- [ ] Ekran okuyucu (VoiceOver/TalkBack) ile: aşama başlığı okunuyor, butonların adı var.
- [ ] Sistem "hareketi azalt" açıkken oyun çalışıyor (sarsıntı/parıltı azalır).
- [ ] Yakınlaştırma (pinch) engellenmemiş.
