# Çocuklarla Deneme Rehberi

Amaç: oyunun 4–12 yaş için anlaşılır, eğlenceli ve yaklaşık 45–90 saniyede biten bir deneyim olduğunu doğrulamak.
Süre: çocuk başına yaklaşık 5 dakika. En az **5 çocuk**, farklı yaşlardan (ör. 4-6, 7-9, 10-12) ve mümkünse hem iPhone hem Android.

## Hazırlık
- Gerçek istatistikleri kirletmemek için **deneme adresini** kullanın:
  `https://lionschildbrushinggame.vercel.app/oyun?k=test-deneme` (alan adı bağlanınca `https://diskahramani.com/oyun?k=test-deneme`)
- Telefonun **sesi açık**, sessiz modu kapalı olsun (`/ses-testi` ile önce deneyin).
- Çocuğa oyunu **anlatmayın**; yalnızca *"Dişlerini fırçalama oyunu, dene bakalım"* deyin. Nerede takıldığını görmek istiyoruz.
- **Çocukların fotoğrafını/videosunu çekmeyin, isim ya da başka bilgi kaydetmeyin.** Yalnızca aşağıdaki gözlem notlarını tutun. Ebeveyne bilgi verin: oyun hiçbir kişisel veri toplamaz.

## Her çocuk için not tablosu
| # | Yaş | Telefon | Süre (sn) | Öğreticiyi anladı mı? | Takıldığı yer | Yardım'a bastı mı? | Ses/kelime tepkisi | Tekrar oynamak istedi mi? |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |

## Gözlenecekler
- **Öğretici:** Parmağını ileri-geri hareket ettirmesi gerektiğini yardımsız anladı mı? Öğreticiyi atladı mı?
- **Fırçalama:** Hareketi doğal buldu mu? Küçük çocuklar leke kaçırıyor mu? Ekran kayıyor ya da sayfa yenileniyor mu?
- **Süre:** Toplam süre 45–90 sn aralığında mı? Çok kısaysa `SWIPES_PER_PATCH` artırılır, çok uzunsa azaltılır (`src/game/constants.ts`).
- **Yüz dönme:** Diş araları bittikten sonra yüzün dönmesi ve "Bitmedi!" yazısı hoşuna gitti mi, şaşırdı mı?
- **Sesler:** "Yuppi", "Büyü tuttu" gibi sözleri fark etti mi, güldü mü? Sesi rahatsız edici buldu mu? Ses seviyesi yeterli mi?
- **Ödül ekranı:** "Diş macunu hediyeni al" mesajını okudu/anladı mı? Görevliye göstermesi gerektiğini biliyor mu? Şeritteki tarih/saat ya da yıldızlar için "bu ne?" diye sordu mu? (İlk denemede saniye sayacı "süre hâlâ akıyor" diye şaşırtmıştı; şimdi saniyesiz tarih-saat var.)
- **Dikkat:** En sıkıldığı yer neresi? Oyunu yarıda bırakan oldu mu (hangi aşamada)?

## Çocuğa sorulacak 3 soru
1. En çok hangi kısmı sevdin?
2. Hiç anlamadığın ya da zorlandığın bir yer oldu mu?
3. Arkadaşlarına gösterir miydin?

## Sonrasında
- Panelde **`/admin?k=test-deneme`** sayfasında saatlik kullanım, ortalama süre, aşama süreleri ve öğretici atlama sayısını görün. Bu sayılar sizin gözleminizle örtüşüyor mu?
- Notları bana gönderin: süre, takılma noktaları, ses/kelime tepkileri. Oyun sürelerini, kelimeleri ve görselleri buna göre ayarlarız.
- Ayarlar bittikten sonra **alan adı bağlama ve QR baskısı** adımına geçilir. Etkinlikten önce test kayıtlarını (`test-deneme` ve gerçek kampanya) temizleyeceğiz.
