# Ödeme Takvimi — kredi kartı ve kredi ödemeleri, iPhone bildirimiyle

Kişisel kredi kartı ekstrelerini ve kredi taksitlerini **Google E-Tablolar**'da tutar, **Google Takvim**'deki
**"Ödemelerim"** takvimine aktarır. iPhone'daki Google Takvim uygulaması vade gününden **2 gün önce** ve
**vade günü 10.00'da** bildirim gösterir.

- Ayrı sunucu yok, ücretli servis yok: kod sizin Google hesabınızda **Google Apps Script** olarak çalışır.
- Günlük kullanım telefondan, yalnızca **hücre, açılır liste ve onay kutusu** ile. Özel menü yoktur.
- Kart numarası, IBAN veya banka giriş bilgisi **istenmez**. Bildirim başlığında **tutar yoktur**.

> Bu klasör, depodaki Diş Kahramanı oyunundan bağımsızdır. Oyunun derlemesine ya da yayınına dahil değildir;
> isterseniz kendi deposuna taşınabilir.

| Dosya | Ne işe yarar |
|---|---|
| [`apps-script/Kod.gs`](apps-script/Kod.gs) | Kodun tamamı, tek dosya. Apps Script editörüne yapıştırılır. |
| [`apps-script/appsscript.json`](apps-script/appsscript.json) | Ayar dosyası (manifest): saat dilimi Europe/Istanbul, Gelişmiş Takvim hizmeti, izinler |
| [`KULLANIM.md`](KULLANIM.md) | iPhone'da günlük kullanım (kısa) |
| `test/` | Sahte Google servisleriyle kabul testleri (`npm test`) ve mutasyon denetimi (`npm run mutasyon`) |

---

## Tek seferlik kurulum

### A. Google hesabınızda sizin yapmanız gerekenler

Bunları sizin yerinize yapamıyorum: tablo sizin Drive'ınızda açılıyor, izinleri yalnızca siz verebiliyorsunuz.
**Bilgisayarda** (Mac ya da PC, tarayıcıyla) yapın; Apps Script editörü iPhone'da rahat çalışmıyor.
Yaklaşık 10 dakika sürer.

1. **Tabloyu oluşturun:** <https://sheets.new> adresini açın, tablonun adını **Ödeme Takvimi** yapın.
2. **Apps Script'i açın:** menüden **Uzantılar → Apps Script**. Açılan sekmede sol üstteki "Adsız proje"
   yazısına tıklayıp adını **Ödeme Takvimi** yapın. İzin ekranında bu ad görünür.
3. **Manifesti görünür yapın:** soldaki **⚙ Proje Ayarları** → **"appsscript.json" manifest dosyasını
   düzenleyicide göster** kutusunu işaretleyin.
4. **Kodu yapıştırın:** soldaki **‹› Düzenleyici**'ye dönün.
   - `appsscript.json` dosyasını açın, içindekileri silin ve bu klasördeki
     [`apps-script/appsscript.json`](apps-script/appsscript.json) dosyasının içeriğini yapıştırın.
   - `Kod.gs` dosyasını açın, içindekileri silin ve [`apps-script/Kod.gs`](apps-script/Kod.gs) dosyasının
     **tamamını** yapıştırın.
   - **Kaydedin** (⌘S / Ctrl+S).

   Manifest üç şey yapar: **Gelişmiş Google Takvim hizmetini** açar (Calendar API v3, tanımlayıcı `Calendar`),
   betiğin saat dilimini **Europe/Istanbul** yapar ve izinleri aşağıdaki üç kalemle sınırlar.
   Manifesti değiştirmek istemezseniz aynı şeyi elle yapabilirsiniz: soldaki **Hizmetler +** →
   **Google Calendar API** → **Ekle**, ardından **⚙ Proje Ayarları → Saat dilimi: (GMT+03:00) İstanbul**.
5. **Kurulumu çalıştırın:** editörün üstündeki işlev listesinde **`kurulum`** seçili olsun → **▶ Çalıştır**.
6. **İzin verin.** İlk çalıştırmada Google onay ister:
   **Yetkilendirme gerekli → İzinleri incele →** hesabınızı seçin → **"Google bu uygulamayı doğrulamadı"**
   uyarısında **Gelişmiş → "Ödeme Takvimi (güvenli değil) sayfasına git"** → izin listesinde **Tümünü seç** →
   **Devam / İzin ver**.

   Bu uyarı çıkar, çünkü betiği Google incelemedi; betik sizin hesabınızda, sizin kopyanızda çalışıyor.
   İstenen izinler ve gerekçeleri:

   | İzin (Google'ın ekranındaki karşılığı) | Ne için |
   |---|---|
   | Bu uygulamanın yüklendiği e-tabloları görme ve yönetme (`spreadsheets.currentonly`) | Yalnızca **bu** tabloyu okuyup yazmak |
   | Google Takvim'deki takvimleri görme, düzenleme, paylaşma ve silme (`calendar`) | "Ödemelerim" takvimini oluşturmak ve içindeki etkinlikleri yönetmek. Kod, kimliğini sakladığı bu takvim dışında hiçbir takvime yazmaz. |
   | Siz yokken çalışma (`script.scriptapp`) | Düzenlemede ve her sabah çalışan tetikleyicileri kurmak |

   İzin listesinde bir kutuyu boş bırakırsanız kurulum hata verir; o durumda `kurulum`'u yeniden çalıştırıp
   **Tümünü seç**'i işaretleyin.
7. **Sonucu kontrol edin.** Alttaki yürütme günlüğünde `Kurulum tamam. Takvim: "Ödemelerim" …` yazmalı.
   Tabloda **Kartlar, Krediler, Ödemeler, Ayarlar** sekmeleri, Google Takvim'de **Ödemelerim** takvimi oluşur.
8. **(Önerilir) Sağlık kontrolü:** işlev listesinden **`saglikKontrolu`** → **▶ Çalıştır**. Günlükte
   bütün satırlar **✓** ile başlamalı. Sonuç tabloda **Ayarlar → Sağlık kontrolü** satırına da yazılır.

`kurulum`'u ikinci kez çalıştırmak güvenlidir: veri silinmez; ikinci bir takvim, etkinlik ya da tetikleyici
oluşmaz. Kodun yeni bir sürümüne geçmek için `Kod.gs`'yi değiştirip `kurulum`'u yeniden çalıştırmanız yeterli.

### B. iPhone'da sizin yapmanız gerekenler

1. App Store'dan **Google E-Tablolar** ve **Google Takvim** uygulamalarını kurun ve **aynı Google hesabıyla**
   giriş yapın.
2. **Google Takvim** → sol üst **☰** menü → hesabınızın altında **Ödemelerim** işaretli olsun. Listede
   görünmüyorsa uygulamayı kapatıp açın.
3. **iPhone Ayarlar → Bildirimler → Google Takvim** → **Bildirimlere İzin Ver** açık; Kilitli Ekran,
   Bildirim Merkezi ve Afişler açık. Bir **Odak** modu (ör. Rahatsız Etme) kullanıyorsanız Google Takvim'i
   izin verilen uygulamalara ekleyin.
4. **Google Takvim → ☰ → Ayarlar** içinde bu cihazda bildirimlerin açık olduğunu kontrol edin
   (menü adı uygulama sürümüne göre değişebilir).
5. **Bildirimi deneyin** — bkz. aşağıda [Telefonda sizin doğrulamanız gerekenler](#telefonda-sizin-doğrulamanız-gerekenler).
6. iPhone'un **yerleşik Takvim** uygulamasına da Google hesabınızı eklediyseniz aynı bildirim iki kez gelebilir.
   Birini kapatın, örneğin **iPhone Ayarlar → Takvim → Hesaplar → Google →** "Takvimler" anahtarı.

---

## Nasıl çalışır

**Sekmeler**

| Sekme | Siz girersiniz | Kod doldurur |
|---|---|---|
| **Kartlar** | Kart kısa adı · olağan son ödeme günü (isteğe bağlı, 1–31) · Aktif/Pasif | Bilgi (sıradaki tahmini vade ya da hata) |
| **Krediler** | Kredi kısa adı · sıradaki taksit tarihi · kalan taksit (bu dahil) · aylık tutar · para birimi | Bilgi (kaç taksit planlandı) |
| **Ödemeler** | Kart/kredi · dönem/taksit · son ödeme (vade) · tutar · para birimi · tarih teyidi · **Ödendi** | Takvim durumu · ödendiği gün · tür |
| **Ayarlar** | Bildirim saati · test düğmeleri (onay kutusu) | Son eşitleme, son hata, takvim kimliği |

İstediğiniz üç veri sekmesine ek olarak küçük bir **Ayarlar** sekmesi var: bildirim saatini değiştirmek ve test
bildirimini telefondan başlatmak için gerekiyor. Ödemeler'in sağında, eşitlemenin kullandığı **gizli teknik
sütunlar** var (Kimlik, Dönem anahtarı, Eşitleme imzası…); bunları açmayın, değiştirmeyin.

**Kredi kartı**
- Olağan gün girilmişse kod **açık ekstre dönemi** için (son ödeme günü bugün ya da sonra olan ilk ay) **tek** bir
  tahmini kayıt açar. Takvimde başlığı **"Ekstreyi kontrol et · [kart]"** olur. Her sabahki eşitleme, siz tabloyu
  açmasanız da vade geçince bir sonraki dönemi açar.
- Ekstre gelince o satıra **gerçek son ödeme tarihini** ve biliyorsanız **dönem borcunu** girip **Tarih teyidi**
  sütununu **Teyitli** yapın. Aynı etkinlik güncellenir, başlık **"Kart ödemesi · [kart]"** olur. Tutar
  bilinmiyorsa boş kalabilir.
- Dönem satırın kendisine bağlıdır, tarihe değil. Gerçek tarih başka bir aya düşse bile o ekstre için ikinci
  etkinlik açılmaz. Aynı kart ve aynı dönem için ikinci bir satır eklenirse o satır **HATA** gösterir ve
  takvime yazılmaz.
- Olağan gün yoksa ekstreyi Ödemeler'e elle eklersiniz. Dönem boş bırakılırsa vadenin ayı yazılır.
- Kod hesap kesim tarihini hiçbir yerde sormaz ve kullanmaz; vade her zaman **son ödeme** tarihidir.
- Olağan günü değiştirirseniz (ör. 15 → 16) yalnızca **teyit edilmemiş, ödenmemiş ve elle değiştirmediğiniz**
  tahmini kayıtlar yeni güne kayar.

**Kredi**
- Sıradaki taksitten başlayarak **kalan taksit sayısı kadar** ayrı ödeme açılır; 6 yazarsanız tam 6.
- Her ay **ilk tarihin gün sayısıyla** hesaplanır: 31 Ocak → 28 Şubat → 31 Mart → 30 Nisan… Hafta sonu ya da tatil
  için kaydırma yapılmaz.
- Bankanın planına göre bir taksidin tarihini ya da tutarını Ödemeler'de değiştirebilirsiniz. Kod, kendi yazdığı
  değeri gizli "Sistem vadesi / Sistem tutarı" sütunlarında saklar. Sizin değeriniz bundan farklıysa sonraki
  eşitlemeler ve kredi bilgisini değiştirmeniz o değere dokunmaz.
- Krediler'deki bilgiyi değiştirirseniz plan yeniden kurulur. Ödenmiş ve elle düzeltilmiş taksitlere dokunulmaz.
  Planın dışında kalan, gelecekteki ve dokunulmamış taksitler silinir. Kredi erken kapandıysa **Kalan taksit**'i
  **0** yapın.

**Takvim ve bildirim**
- "Ödemelerim" takvimi sizin hesabınızda açılır; saat dilimi **Europe/Istanbul**'dur. Kimliği betik özelliklerinde
  ve Ayarlar sekmesinde saklanır.
- Her açık ödeme için vade günü **10.00**'da başlayan **tek bir 30 dakikalık etkinlik** oluşur (saat
  **Ayarlar → Bildirim saati** ile değiştirilir). Etkinliğin **varsayılan hatırlatmaları kapalıdır**; yalnızca
  **iki popup** hatırlatma vardır: başlangıçtan **2880 dakika önce** ve **başlangıç anında (0 dk)**.
- **Ödendi** işaretlenince satır ödeme geçmişi olarak tabloda kalır. Etkinlik takvimde durur ama hatırlatmaları
  kaldırılır, başına ✓ eklenir (bunu ben ekledim; takvim görünümünde ödenenleri ayırt etmek için).
  Yanlışlıkla işaretlediyseniz kutuyu boşaltın: **zamanı henüz gelmemiş** hatırlatmalar geri gelir.
- Başlık yalnızca "Ekstreyi kontrol et / Kart ödemesi / Kredi taksiti · [ad]" biçimindedir. Tutar yalnızca
  etkinliğin açıklamasında yazar; bunu **Ayarlar → Etkinlik açıklamasında tutar: Hayır** ile kapatabilirsiniz.

**Güvenilirlik**
- **Kurulabilir düzenleme tetikleyicisi** (`duzenlemedeEsitle`): telefondan yaptığınız her düzenleme sizin
  yetkinizle birkaç saniye içinde takvime aktarılır. **Değişiklik tetikleyicisi** (`degisiklikteEsitle`):
  satır silinince artık etkinliği hemen kaldırır. **Günlük tam eşitleme** (`gunlukEsitle`, her sabah 06.00
  civarı): dönemleri ilerletir, kaçan değişiklikleri tamamlar, takvimden silinmiş açık etkinliği geri getirir,
  Ödemeler'i sıralar.
- Her ödeme satırının **değişmeyen bir Kimlik**'i vardır ve etkinliğin kimliği bundan türetilir. Kurulum ya da
  eşitleme kaç kez çalışırsa çalışsın her satırın tek bir etkinliği olur. Etkinlik zaten varsa (409) yenisi
  açılmaz, mevcut olan güncellenir. Tetikleyiciler kurulurken var olan bir daha kurulmaz, fazlası silinir.
- Takvime yazılan hal satırda bir **imza** olarak saklanır; değişmeyen satır için Google'a hiç istek gitmez.
  Yazım başarısız olursa satırın **Takvim durumu** sütununda `HATA: …` görünür, imza güncellenmez ve sonraki
  eşitleme yeniden dener. Geçici Google hataları aynı çalıştırmada üç kez yeniden denenir.
- Eşitlemeler kilitle sırayla çalışır. Yazmadan önce satırın yerinden kaymadığı kontrol edilir. Çalışma 4,5
  dakikayı geçerse kalan satırlar "Bekliyor" olur ve bir dakika sonra kendiliğinden devam edilir.
- Ödemeler sekmesi bir anda tamamen boşalırsa (yanlışlıkla toplu silme) takvimdeki etkinlikler güvenlik için
  silinmez; Ayarlar'a uyarı yazılır.

---

## Doğrulama

### Kodla doğruladıklarım

`odeme-takvimi` klasöründe `npm test` komutu (Node 20+, bağımlılık yok) kodu, Google E-Tablolar, Takvim,
tetikleyici ve özellik servislerinin **bellek içi taklidinde** çalıştırır. Kullanıcı düzenlemeleri, hücre hücre
yazılıp kurulu tetikleyici çağrılarak benzetilir. Taklit bilerek zor davranır: onay kutusu uygulanan boş hücreler
`FALSE` olur, düz metin biçimi olmayan hücrede "2026-11" ya da "3/6" tarihe döner, silinen etkinlik aynı kimlikle
yeniden eklenince 409 verir.

**Sonuç: 38 testin 38'i geçti.** İstediğiniz senaryolar:

| Senaryo | Doğrulanan |
|---|---|
| Kart vadesinin 15'inden 16'sına taşınması | Olağan gün 15 → 16: tek satır, **aynı** etkinlik 16'sı 10.00'a taşındı, yeni etkinlik eklenmedi. Ekstre teyidiyle 16 girilince: aynı etkinlik, başlık "Kart ödemesi · Bonus", başlıkta rakam yok, tutar yalnızca açıklamada. Teyitli tarih sonradan olağan gün değişse de korunuyor. |
| Altı taksitli kredinin tam altı kayıt üretmesi | Kalan 6 → tam 6 satır (1/6…6/6) ve 6 etkinlik. Kalan 6 → 8 → (yeniden başlat) 5 → 0 değişikliklerinde açık taksit sayısı her seferinde tam olarak eşleşiyor; ödenen taksit geçmişte kalıyor. |
| Ay sonu geçişi | 31.01.2027 → 28.02 → 31.03 → 30.04 → 31.05 → 30.06; artık yılda 31.01.2028 → 29.02.2028; 30.12 → 30.01 → 28.02 → 30.03. Gün 31 olan kart: 30 Kasım, 31 Aralık, 28 Şubat. |
| Ödendi kutusunun işaretlenip geri alınması | İşaretleyince hatırlatmalar `[]`, varsayılan kapalı, başlık "✓ …", satır ve etkinlik duruyor, "Ödendiği gün" doldu. Geri alınca 2880 ve 0 dk geri geldi, gün temizlendi. Vadeye 2 günden az kala geri alınınca yalnızca 0 dk geri geldi. |
| Aynı verinin iki kez eşitlenmesi | İkinci ve sonraki tam/günlük/hızlı eşitlemeler ve `kurulum`'un yeniden çalışması: takvime **0** yazma; etkinlik, satır, takvim ve tetikleyici sayıları değişmedi. `kurulum` üç kez: tek takvim, her tetikleyiciden bir tane. |

Ayrıca doğrulananlar: tahmini başlık ve 10.00 saati, Europe/Istanbul, tam iki popup (2880, 0) ve varsayılanların
kapalı olması; dönemlerin yalnızca günlük tetikleyiciyle 112 gün boyunca ilerlemesi (her dönem için tek kayıt);
olağan gün yokken elle ekstre; aynı döneme ikinci satırın HATA vermesi; kopyala-yapıştırılan satırın yeni kimlik
alması; tek taksit düzeltmesinin hem eşitlemelerde hem kredi bilgisi değişince korunması; başarısız yazımın satırda
`HATA` göstermesi ve sonraki eşitlemede kendiliğinden düzelmesi; satır silinince etkinliğin kalkması; takvimden
silinen açık etkinliğin aynı kimlikle geri gelmesi; bildirim saatinin Ayarlar'dan değişmesi; test bildirimi
(yaklaşık 5 dk sonra, tek popup, Ayarlar kutusuyla da çalışıyor, silinebiliyor, bir günden eskisi her sabah
siliniyor); zaman sınırı aşılınca tek bir devam tetikleyicisi; günlük sıralama; ilgisiz sekmenin eşitleme
başlatmaması; hiçbir başlıkta kart numarası, IBAN ya da şifre sorulmaması.

**Testlerin gerçekten işe yaradığının denetimi** (`npm run mutasyon`): koda bilerek 18 ayrı hata sokuldu
(tek hatırlatma, varsayılan hatırlatmalar açık, aynı döneme ikinci kayıt, imzanın yok sayılması, 409'un
yakalanmaması, fazladan taksit, elle düzeltmenin ezilmesi, ters başlıklar, ay sonu kuralı olmaması, tetikleyicinin
çoğalması…). **18'inin hepsini en az bir test yakaladı.**

### Kodla doğrulayamadıklarım

Testler Google'a bağlanmaz. Aşağıdakiler gerçek Google davranışına dayanır ve ancak sizin hesabınızda
doğrulanabilir:

1. Takvim API'sinin özel etkinlik kimliğini kabul etmesi; silinmiş bir kimlik yeniden eklenince 409 vermesi ve
   `status: confirmed` ile PATCH edilen etkinliğin geri gelmesi.
2. PATCH ile gönderilen boş hatırlatma listesinin uygulanması. Uygulanmazsa kod bunu fark edip etkinliği tam
   haliyle yeniden yazar; bu yol da test edildi.
3. Zamanı geçmiş bir hatırlatmanın sonradan bildirim üretmemesi.
4. **iPhone E-Tablolar uygulamasından** yapılan düzenlemenin kurulabilir düzenleme tetikleyicisini çalıştırması.
   Çalıştırmasa bile her sabahki günlük eşitleme değişikliği takvime aktarır.

Bunların ilk üçünü **`saglikKontrolu`** gerçek hesabınızda denetler. Dördüncüsünü aşağıdaki 2. adımda kendiniz
görürsünüz.

### Telefonda sizin doğrulamanız gerekenler

1. **Test bildirimi:** iPhone'da Google E-Tablolar'da tabloyu açın → **Ayarlar** sekmesi → **Test bildirimi
   oluştur** kutusunu işaretleyin. Birkaç saniye içinde kutu kendiliğinden boşalır ve **Test sonucu** satırına
   saat yazılır (ör. "… 19:06 için açıldı (5 dk sonra)"). Telefonu kilitleyin. O saatte
   **"Test bildirimi · Ödeme Takvimi"** bildirimi gelmeli. Ardından **Test etkinliklerini sil** kutusunu
   işaretleyin.
2. **Telefondan düzenleme aktarılıyor mu:** Kartlar'a `Deneme` adında bir kart ekleyin, olağan günü `15` seçin.
   Ödemeler'de yeni satır açılmalı ve **Takvim durumu** yaklaşık 10 saniye içinde **"Takvimde ✓"** olmalı.
3. **Etkinlik doğru mu:** Google Takvim'de 15'indeki **"Ekstreyi kontrol et · Deneme"** etkinliğini açın:
   saat 10.00, bildirimlerde **yalnızca iki satır** olmalı: "2 gün önce" ve "Etkinlik zamanında" (uygulama
   bunları farklı adlandırabilir).
4. **Ödendi:** satırdaki **Ödendi** kutusunu işaretleyin → etkinlikte bildirim kalmamalı, başlık "✓ …" olmalı.
   Kutuyu boşaltın → iki bildirim geri gelmeli.
5. Denemeyi temizleyin: Ödemeler'deki satırı ve Kartlar'daki satırı silin; etkinlik takvimden kalkar.

---

## Sorun giderme

| Belirti | Ne yapmalı |
|---|---|
| "Takvim durumu" güncellenmiyor | **Ayarlar → Son eşitleme** saatine bakın. **Şimdi tam eşitle** kutusunu işaretleyin. Bilgisayarda Apps Script → **⏰ Tetikleyiciler** sayfasında 3 tetikleyici olmalı; yoksa `kurulum`'u çalıştırın. |
| Satırda `HATA: …` | Metin hatanın nedenini söyler; eşitleme kendiliğinden yeniden dener. Sürerse bilgisayarda `simdiEsitle` çalıştırın, sonra **Apps Script → Yürütmeler** sayfasına bakın. |
| `Eksik: …` | Satırda zorunlu bir hücre boş (ör. vade). Doldurunca kendiliğinden düzelir. |
| Kartlar/Krediler'de `HATA: … adı başka bir satırda da var` | Kart ve kredi adları birbirinden farklı olmalı. |
| Bildirim gelmiyor | iPhone bildirim izni, Odak modu, Google Takvim'de "Ödemelerim"in işaretli olması; etkinliği açıp bildirimlerin göründüğünü kontrol edin. |
| Google'dan "betik hatası" e-postası | Bir tetikleyici çalışmasının tamamı başarısız olmuş demektir. Ayrıntı **Ayarlar → Son hata** satırında. |

Sütun başlıklarını değiştirmeyin; sütunların yerini değiştirebilirsiniz. "Ödemelerim" takvimini başkasıyla
paylaşmayın: etkinlik açıklamasında (açıksa) tutar ve tablonun bağlantısı var.

## Kaldırma

Apps Script'te **`kaldir`** → ▶ Çalıştır: bu uygulamanın tetikleyicileri silinir; tablo ve takvim yerinde kalır.
Takvimi de silmek isterseniz: Google Takvim (bilgisayar) → **Ayarlar → Ödemelerim → Takvimi kaldır**.

## Geliştirici notları

```bash
cd odeme-takvimi
```

```bash
npm test
```

```bash
npm run mutasyon
```

- `Kod.gs`'deki `_` ile biten işlevler özeldir; editörün işlev listesinde görünmez. Editörde ilk görünen işlev
  `kurulum`'dur.
- Saf yardımcılar (tarih, dönem, tutar, imza) Google servisine dokunmaz; `test/birim.test.mjs` bunları doğrudan
  sınar.
- `test/gas-mock.mjs`, `KOD_GS` ortam değişkeniyle başka bir `Kod.gs` kopyasını yükleyebilir; mutasyon denetimi
  bunu kullanır.
