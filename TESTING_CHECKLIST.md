# Test Kontrol Listesi

## A. Otomatik testler (her değişiklikte, CI'da da çalışır)

```bash
npm run lint && npm run typecheck && npm test      # 60+ birim testi
npm run build && npm run test:e2e                  # uçtan uca (Playwright)
```

Kapsam:

- **Oyun motoru:** swipe algılama, tek dokunuşla temizlenmeme, 6 aşamanın sırayla bitmesi, ilerlemenin monoton artması, yardım/ipucu, arka planda süre şişmemesi.
- **Analytics istemcisi:** çevrimdışı kuyruk, sayfa yenilense de kuyruğun korunması, 503'te tutma / 400'de atma, 20'lik gruplar, depolama kapalıyken çalışma, ilk/tekrar oyun ayrımı.
- **Kendini değerlendirme:** soru yalnızca özellik açıkken, aşama BİTİNCE (sahne tamamen temizken), aşama başına bir kez, son aşama ve öğretici hariç; soru süresi oyun süresine sayılmaz; Evet/Hayır sayısı-oranı-aşama dökümü; hem asıl hem deneme kampanyasında çıktığı (cevapların o kampanyanın kimliğiyle gittiği) ve klinik kartının yalnızca deneme kampanyasında olduğu; `0002` geçişinin `EVENT_NAMES` ile birebir uyumu.
- **Sunucu:** kampanya/UUID/olay adı doğrulaması, fazladan (kişisel) alanların atılması, saat sapması düzeltmesi, çift gönderimde tek kayıt.
- **KPI:** ziyaret/başlama/tamamlama ayrımı, tamamlama oranı, başlatma oranı, ilk oyun süresi, İstanbul saatiyle saatlik dağılım, gece yarısı sınırı, boş veri; soru göstergeleri (çocuğun ilk cevabı, ilk oyun/tekrar ayrımı, soruların eklediği süre); **tarih aralığı süzgeci** (İstanbul gün sınırı, uçlar dahil, geçersiz değerler yok sayılır; panel, rapor ve CSV aynı aralığı kullanır, veri silinmez).
- **CSV:** BOM, `;`, Türkçe karakter, formül enjeksiyonu koruması.
- **Yönetici girişi:** doğru/yanlış parola, süre dolumu, kurcalanmış token, yapılandırma yoksa kapalı.
- **QR:** logolu ve logosuz üretilen kod bir çözücüyle **geri okunur**, küçük baskı boyutunda da.
- **E2E:** tam oyun (öğretici → 6 aşama → ödül → tekrar), olay sırası ve gizlilik (gövdede yalnızca izinli alanlar), öğretici atlama, yardım butonu, ses tercihi, **çevrimdışı oyun + kuyruğun internet gelince boşalması**, **service worker ile internetsiz açılış**, **gerçek dokunmatik olaylar**, admin erişim koruması, dashboard/rapor/CSV/QR indirme.

## B. Etkinlikten ÖNCE el ile yapılacak testler

Gerçek cihaz gerektirir; bu depoda otomatikleştirilemez. Test için hep `…/oyun?k=test-deneme` adresini kullanın (gerçek sayıları kirletmez). Asıl adreste (`/oyun`) yapılan denemeler, soru cevapları dahil, **gerçek sayılara girer**; yine de yaptıysanız panelde tarih filtresiyle ayırabilirsiniz.

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
- [ ] **Diş çizimleri:** ön dişler güzel bir gülüş gibi: merkez kesiciler geniş ve parlak beyaz, yan kesiciler daha dar/kısa, köpek dişleri yumuşak uçlu, dişler yanlara doğru küçülüyor, kesici kenar çizgisi kavisli; diş eti pürüzsüz ve ıslak parlak. İç yüzde dişlerin arkası (kenar sırtları, çukur), damakta enine kıvrımlar, dilde papillalar görünüyor. Çiğneme aşamasında azılar tümsekli, olukları ve çukurları olan gerçek azı dişleri gibi. Öğreticide kökleriyle tam bir diş görünüyor. **Eski/ucuz telefonda** öğreticiden sonraki aşama geçişlerinde (özellikle iç yüzeye ve çiğnemeye geçerken) belirgin bir donma yok ve akıcılık eskisinden kötü değil (sahne önbelleği + sprite ön hazırlığı).
- [ ] **Telefonda ses** (en önemli): `/ses-testi` sayfasında "Sesi dene" → durum "Açık ✅" ve ses duyuluyor; iPhone sessiz düğmesi açıkken de oyun sesleri geliyor mu? (Bu özellik iOS 17+ ve eski iOS için ayrı yöntemle yapıldı; gerçek iPhone'da doğrulayın.)
- [ ] Ses: 🔊/🔇 çalışıyor, ilk dokunuştan sonra ses geliyor, sessizde oyun tam anlaşılıyor, sessiz anahtarı (iPhone) açıkken çok rahatsız etmiyor.
- [ ] **Aşama bitince "yu-up-pi!" sesi** (kayan ses + parıltı) geliyor. Bu sesler kodla üretilir; **gerçek telefonda kulakla** dinleyin ve gerekirse `src/game/audio.ts` içindeki `yay` sesini ayarlayın.
- [ ] Telefonda **yerel Türkçe ses** kurulu ise kısa bir övgü de söylenir (oyun/büyü tarzı: "Yuppi!", "Süper güç!", "Seviye atladın!", "Sihirbaz gibisin!", "Bir yıldız daha!", "Pırıl pırıl!"; ağız açılırken "Ağzını aç, aa de!"; oyun sonunda "Diş kahramanı oldun! Bravo sana!"). **İlk aşamanın "Yuppi!" sesi de net duyulmalı.** Ses yoksa yalnızca efekt çalar. Bulut (çevrim içi) sesler bilerek kullanılmaz; gizlilik için metin dışarı gitmez.
- [ ] **Ağız açma:** diş araları bitince yüz dönmez; çene aşağı inip ağız kocaman açılıyor ("Aaa de!"), alt dişler çeneyle birlikte iniyor, damak, küçük dil, bademcikler ve dil görünüyor; sonra lekeler belirip iç yüzeyler fırçalanıyor. Geçiş akıcı: takılma, titreme, ani renk sıçraması ya da ağız kapalıyken kısa süre görünen boşluk yok. Hareketi azalt ayarı açıkken (telefon erişilebilirlik ayarı) animasyon yok, sahne doğrudan değişiyor. `/ses-testi` sayfasındaki "Ağız açma sesi" düğmesi çalışıyor: çene inerken yumuşak bir "vınn" duyuluyor, kaba ya da boğuk bir ses çıkmıyor; telefonda yerel Türkçe ses kuruluysa çene inince "Ağzını aç, aa de!" deniyor (ses yoksa yalnızca "vınn"). Konuşma gelmezse `/ses-testi` sayfasında **"Konuşmayı dene"**ye dokunun: "Türkçe konuşma" satırı "Var ✅" mı, "Son konuşma" satırı "Başladı/Bitti ✅" mi yoksa "Hata ❌ (kod)" mı gösteriyor, not alın.
- [ ] Türkçe karakterler (ç ğ ı İ ö ş ü) her ekranda doğru.
- [ ] Ödül ekranı: "TEBRİKLER! DİŞ KAHRAMANI OLDUN!", klinik fırsatı kartı ("Ücretsiz muayene fırsatı!", Koşuyolu Park logosu, www.kosuyolupark.com; kampanyada `clinicOffer` kapalıysa görevliye göster + diş macunu), 3 mesaj net; şeritte "Süren: … dk … sn" (oyun süresine uyuyor) ve bugünün tarihi/saati (saniyesiz) görünüyor; 2 dakikadan kısa sürede "Hızlı fırçaladın!…", 2 dakika ve üzerinde "ideal süreye ulaştın!…" mesajı çıkıyor; parıltı/yıldızlar hareket ediyor; "Tekrar Oyna" çalışıyor.

### "Sence yeterli ve etkin temizlendi mi?" (asıl `/oyun` ve deneme `/oyun?k=test-deneme`) ve klinik fırsatı (iki kampanyada da)
- [ ] Her aşama (1–5) **tamamen temizlenince** (tüm lekeler gidince, sonraki aşamaya geçmeden) **oyun durur** ve soru çıkar; temizlik bitmeden **çıkmaz**; **son aşamada (diş ipi) hiç çıkmaz**. Soru açıkken arkadaki "Yardım"/fırçalama çalışmaz.
- [ ] **Evet** → "Henüz bitmedi! Sırada … var." (o aşamadan sonra kalan yüzeyleri doğru sayıyor); **Hayır** → "Aferin, işi biliyorsun!…" tebriki. **Devam**'a dokununca (ya da ~4,5 sn sonra kendiliğinden) sonraki aşamaya geçilir (diş araları bitince ağız açılması dahil).
- [ ] Ödül ekranında diş macunu/standdaki görevli yerine **"Ücretsiz muayene fırsatı!" + Koşuyolu Park** kartı var; logo görünüyor. Kartın en altındaki **www.kosuyolupark.com** bağlantısına dokununca klinik sitesi **yeni sekmede** açılıyor (gerçek telefonda deneyin; oyun sekmesi açık kalıyor).
- [ ] `/admin?k=test-deneme` (ve `/admin`) → **"Sence yeterli ve etkin temizlendi mi?" cevapları** bölümünde Evet/Hayır sayısı ve oranı, aşama dökümü doğru (birkaç cevap verip karşılaştırın). Rapor sayfasında ve CSV'de de var.
- [ ] **Asıl kampanyada** (`/oyun`, `?k=` yok) da aynı soru ve aynı klinik kartı çıkıyor (diş macunu kartı yerine); web sitesi bağlantısı yeni sekmede açılıyor. Cevaplar `/admin` panelinde görünüyor.
- [ ] **Çevrimdışı:** oyun bir kez açıldıktan sonra internet kesilip oyun bitirilince ödül ekranında klinik **logosu** görünüyor (kırık resim yok).
- [ ] (Yeni veritabanı kurulumunda / yayından önce) `supabase/migrations/0002_self_check_events.sql` uygulandı: cevaplar panelde görünüyor. (Canlı veritabanında 13.10.2026'da uygulandı.)
- [ ] **Soru oyunu uzatıyor mu?** Gerçek çocuklarla toplam süre (soru dahil) kabul edilebilir mi, çocuk sıkılıp bırakıyor mu? Panelde **"Soruların eklediği süre"** ile **Tamamlama** oranına bakın; belirgin düşerse soruyu kısaltın (ör. yalnızca bazı aşamalarda).
- [ ] Panelde **tarih aralığı** (ilk gün – son gün) seçince kartlar, saatlik grafik, soru bölümü, rapor ve CSV yalnızca o günleri kapsıyor; **Temizle** ile tüm dönem geri geliyor. Etkinlik gününü seçince deneme oyunları sayılmıyor.

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
