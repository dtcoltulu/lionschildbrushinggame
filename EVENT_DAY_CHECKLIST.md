# Etkinlik Günü Kontrol Listesi

**11 Ekim 2026 – Dünya Lions Hizmet Günü · Özgürlük Parkı, Kadıköy**

Yazdırıp standda bulundurun. Kutuları işaretleyin.

## 📅 Önceki gün (evde/ofiste)

- [ ] Canlı adres açılıyor: `https://…/oyun`
- [ ] Yönetici parolası **iki kişide** var; panel giriş yapıldı
- [ ] Basılı QR'lar (en az 3 kopya: stant, masa, yedek) çıktıdan okutuldu
- [ ] Deneme verisiyle prova: `…/oyun?k=test-deneme` (gerçek sayaç **0** olmalı)
- [ ] Stant telefonu/tabloleti şarjlı; yedek şarj cihazı (powerbank) hazır
- [ ] Yedek plan: QR'ın ekran görüntüsü + adresin büyük yazılı hali (QR okunmazsa çocuk adresi yazabilsin)

## 🔲 1. QR testi (stant kurulunca, açılıştan önce)

- [ ] QR'ı standın **kurulu yerinde**, gerçek ışıkta okutun (güneş yansıması? gölge?)
- [ ] Telefon kamerasıyla okununca **doğrudan** oyun açılıyor
- [ ] 3 farklı mesafede (30 / 60 / 100 cm) okunuyor
- [ ] QR üzerinde parlama/buruşma yok; rüzgâra karşı sabitlendi

## 🍎 2. iPhone testi

- [ ] Safari'de oyun açılıyor; kamera uygulamasından QR ile açılıyor
- [ ] Parmakla fırçalama akıcı, sayfa kaymıyor / yenilenmiyor
- [ ] Ses ilk dokunuştan sonra geliyor (sessiz anahtar açıksa sessiz kalması normaldir)
- [ ] Tam oyun 45–90 sn'de bitiyor

## 🤖 3. Android testi

- [ ] Chrome'da oyun açılıyor; kamera/Google Lens ile QR okunuyor
- [ ] Parmakla fırçalama akıcı
- [ ] Tam oyun bitiyor; ödül ekranı geliyor

## 📶 4. Mobil internet testi

- [ ] Wi-Fi **kapalı**, yalnızca mobil veriyle QR → oyun açılıyor (park alanında çekim gücünü kontrol edin)
- [ ] Açılış süresi kabul edilebilir (≤ ~5 sn)
- [ ] Çekim zayıfsa: standa "ücretsiz Wi-Fi/hotspot" düşünün (yedek telefonda kişisel erişim noktası)

## ✈️ 5. Wi-Fi kapalı / internetsiz test

- [ ] Oyunu bir kez açın, sonra **uçak modu**: sayfayı yenileyin → hâlâ açılıyor
- [ ] Uçak modundayken oyunu bitirin → **ödül ekranı geliyor**
- [ ] Uçak modunu kapatın → 1 dakika içinde panelde olaylar belirir (kayıp yok)

## 📊 6. Analytics testi

- [ ] Panelde **Gerçek** kampanya seçili (Dünya Lions Hizmet Günü, "Deneme" değil)
- [ ] Bir gizli sekmeyle oyun oynayın → Landing +1, Başlatan +1, Tamamlayan +1
- [ ] "Tekrar Oyna" → Tekrar Oynama +1, Başlatan **artmadı**
- [ ] Saatlik grafikte içinde bulunulan saat görünüyor
- [ ] Test sayılarını not alın (etkinlik sayaçlarından **çıkarılacak**: test oyunlarınızı ayrıca kaydedin)

## 🖥️ 7. Admin dashboard testi

- [ ] `…/admin` telefondan giriş yapılıyor; sayılar okunuyor
- [ ] "Otomatik yenile" açık
- [ ] **Etkinlik Raporu Oluştur** açılıyor; CSV inebiliyor (etkinlikten önce bir kez deneyin)
- [ ] Panele yetkisiz kişinin erişemediğini doğrulayın (giriş yapmamış tarayıcıda `/admin` → giriş sayfası)

## 🔊 Ses testi (her telefon türünde)

- [ ] `https://…/ses-testi` adresini açın, **"Sesi dene"**ye dokunun: durum **"Açık ✅"** olmalı ve ses duyulmalı
- [ ] iPhone'da yan **sessiz düğmesi kapalı** (turuncu görünmemeli) ve medya sesi açık
- [ ] Bluetooth kulaklık bağlı değil (ses oraya gider)
- [ ] Ses yine yoksa sayfadaki ipuçlarına bakın; oyun sessiz de tamamen oynanabilir (ses zorunlu değil)

## 🏆 8. Ödül ekranı testi

- [ ] "TEBRİKLER! DİŞ KAHRAMANI OLDUN!" görünüyor
- [ ] "Bu ekranı Lions standındaki görevliye göster." ve "Diş macunu hediyeni al." görünüyor
- [ ] **Canlı saat akıyor** (görevliler bu saate bakarak eski ekran görüntülerini ayırt eder)
- [ ] Görevliler bilgilendirildi: ödül ekranı = 1 diş macunu; "Tekrar Oyna" ile gelen ekran için ekibin ortak kararı (ör. aynı çocuğa tekrar verilmez)

## 🎈 Etkinlik sırasında

- [ ] Saatte bir panele bakın: sayılar artıyor mu? Tamamlama oranı %70+ mı? (Düşükse bir şey takılıyordur: çocukları gözlemleyin.)
- [ ] Dağıtılan diş macunu sayısını **elle de** sayın (her saat başı not alın); sonra panelle karşılaştırın
- [ ] Tamamlama oranı ani düşerse: telefonda oyunu deneyin, internet/çekim durumunu kontrol edin
- [ ] Sorun olursa bu bilgilerle Slack/WhatsApp'a haber verin: saat, cihaz, ne oldu

## 🧾 Etkinlik sonrası (aynı gün akşam)

- [ ] `…/admin` → **Etkinlik Raporu Oluştur** → PDF olarak kaydet + CSV indir; iki kişiye gönderin
- [ ] Toplam tamamlanma ↔ dağıtılan diş macunu karşılaştırması: __________ / __________
- [ ] Çocuklardan/ekipten gözlem notları: kullanılabilirlik, takılan noktalar, süre
- [ ] Panel parolasını değiştirin (isteğe bağlı) ve verileri saklayın/silin (`supabase/purge.sql`)
