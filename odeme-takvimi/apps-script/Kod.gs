/**
 * ÖDEME TAKVİMİ — kişisel kredi kartı ve kredi ödemeleri
 * Veri girişi: Google E-Tablolar (Kartlar, Krediler, Ödemeler + küçük bir Ayarlar sekmesi)
 * Bildirim:    Google Takvim'deki "Ödemelerim" takvimi (iPhone'da Google Takvim uygulaması)
 *
 * Editörden çalıştırılan işlevler (üstteki açılır listeden seçip ▶ Çalıştır):
 *   kurulum()               Tek seferlik kurulum. Tekrar çalıştırmak güvenlidir.
 *   testBildirimiOlustur()  Birkaç dakika sonrasına silinebilir bir test etkinliği açar.
 *   testEtkinlikleriniSil() Test etkinliklerini siler.
 *   simdiEsitle()           Tam eşitleme (günlük eşitlemeyi beklemeden).
 *   saglikKontrolu()        Tetikleyici, takvim ve etkinlikleri denetler; sonucu Ayarlar'a yazar.
 *   kaldir()                Tetikleyicileri kaldırır (tablo ve takvim yerinde kalır).
 *
 * Günlük kullanım yalnızca hücre, açılır liste ve onay kutusuyla yürür; özel menü yoktur
 * (iPhone'daki E-Tablolar uygulaması özel menü göstermez).
 *
 * Temel kurallar
 *  - Tablo esastır, takvim onun aynasıdır. Değişiklikler tabloda yapılır.
 *  - Her ödeme satırının değişmeyen bir Kimlik'i vardır. Takvim etkinliğinin kimliği bu
 *    Kimlik'ten türetilir; aynı satır kaç kez eşitlenirse eşitlensin tek etkinlik olur.
 *  - Her satır için takvime yazılan halin imzası saklanır; değişmeyen satır için takvime
 *    hiç istek gitmez. Başarısız yazımda imza güncellenmez, sonraki eşitleme yeniden dener.
 */

// ===========================================================================
// 1) Sabitler — değiştirmeniz gerekmez
// ===========================================================================
var SURUM = '1.0.0';
var TZ = 'Europe/Istanbul';
var TAKVIM_ADI = 'Ödemelerim';
var UYGULAMA = 'odeme-takvimi';
var HATIRLATMA_DK = [2880, 0]; // 2 gün önce ve başlangıç anında, ikisi de popup
var ETKINLIK_SURESI_DK = 30;
var GUNLUK_SAAT = 6; // günlük eşitleme 06.00 civarı (Europe/Istanbul)
var ZAMAN_BUTCESI_MS = 270000; // Apps Script 6 dk sınırının epey altında dur
var PARA_BIRIMLERI = ['TRY', 'USD', 'EUR', 'GBP'];
var TAHMINI = 'Tahmini';
var TEYITLI = 'Teyitli';
var AKTIF = 'Aktif';
var PASIF = 'Pasif';
var TUR_KART = 'Kart';
var TUR_KREDI = 'Kredi';
var OTO = 'oto';
var ELLE = 'elle';
var AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
var RENK = { tahmini: '5', teyitli: '6', kredi: '9', odendi: '8', test: '3' };
var TETIKLEYICILER = ['duzenlemedeEsitle', 'degisiklikteEsitle', 'gunlukEsitle'];
var DEVAM_TETIKLEYICISI = 'devamEsitle';
var AYAR_SAYFASI = 'Ayarlar';
var CELL_TZ = TZ; // tablonun saat dilimi; her eşitlemenin başında tablodan okunur

/** Sekme ve sütun tanımları. Başlıklar sütunların adıdır: değiştirmeyin, yerlerini değiştirebilirsiniz. */
var SPEC = {
  kartlar: {
    name: 'Kartlar',
    freezeCols: 1,
    cols: [
      { key: 'ad', title: 'Kart (kısa ad)', width: 150,
        note: 'Kısa bir ad yazın (ör. Bonus, Axess). Kart numarası, IBAN veya banka şifresi YAZMAYIN.' },
      { key: 'gun', title: 'Olağan son ödeme günü', width: 140,
        note: 'İsteğe bağlı (1–31). HESAP KESİM günü değil, SON ÖDEME günü.\nDoluysa her ekstre dönemi için tahmini bir kayıt kendiliğinden açılır.\nBoşsa ekstreyi Ödemeler sekmesine elle eklersiniz.',
        rule: function () { return listRule_(numberList_(1, 31), 'Son ödeme günü (1–31). Boş bırakabilirsiniz.'); } },
      { key: 'durum', title: 'Aktif / Pasif', width: 100,
        note: 'Pasif kart için yeni tahmini kayıt açılmaz; mevcut kayıtlar korunur. Boş = Aktif.',
        rule: function () { return listRule_([AKTIF, PASIF], 'Aktif veya Pasif'); } },
      { key: 'bilgi', title: 'Bilgi (otomatik)', width: 320, auto: true },
      { key: 'kimlik', title: 'Kimlik', tech: true, text: true },
      { key: 'sonDonem', title: 'Son açılan dönem', tech: true, text: true },
    ],
  },
  krediler: {
    name: 'Krediler',
    freezeCols: 1,
    cols: [
      { key: 'ad', title: 'Kredi (kısa ad)', width: 150, note: 'Kısa bir ad (ör. Konut, Taşıt). Hesap/IBAN bilgisi yazmayın.' },
      { key: 'ilkTarih', title: 'Sıradaki taksit tarihi', width: 130, date: true,
        note: 'Ödenmemiş ilk taksidin tarihi. Sonraki aylar bu günün sayısına göre hesaplanır (31 Ocak → 28 Şubat → 31 Mart). Hafta sonu/tatil kaydırması yapılmaz.',
        rule: function () { return dateRule_(); } },
      { key: 'kalan', title: 'Kalan taksit (bu dahil)', width: 120,
        note: 'Sıradaki taksit DAHİL kalan taksit sayısı. 6 yazarsanız tam 6 ödeme kaydı açılır. Kredi kapandıysa 0 yazın.',
        rule: function () { return SpreadsheetApp.newDataValidation().requireNumberBetween(0, 600).setAllowInvalid(false).setHelpText('0–600 arası tam sayı').build(); } },
      { key: 'tutar', title: 'Aylık taksit tutarı', width: 120, money: true,
        rule: function () { return SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).setHelpText('Tutar (ör. 12.345,67). Boş bırakılabilir.').build(); } },
      { key: 'paraBirimi', title: 'Para birimi', width: 90,
        rule: function () { return listRule_(PARA_BIRIMLERI, 'Para birimi'); } },
      { key: 'bilgi', title: 'Bilgi (otomatik)', width: 320, auto: true },
      { key: 'kimlik', title: 'Kimlik', tech: true, text: true },
      { key: 'planImzasi', title: 'Uygulanan plan', tech: true, text: true },
    ],
  },
  odemeler: {
    name: 'Ödemeler',
    freezeCols: 1,
    cols: [
      { key: 'ad', title: 'Kart / kredi', width: 130, input: true,
        note: 'Listeden seçin. Liste Kartlar ve Krediler sekmelerinden otomatik dolar.' },
      { key: 'donem', title: 'Dönem / taksit', width: 110, input: true, text: true,
        note: 'Kartta ekstre dönemi (ör. Kasım 2026), kredide taksit sırası (ör. 3/6). Elle eklediğiniz kart satırında boş bırakırsanız vadenin ayı yazılır.' },
      { key: 'vade', title: 'Son ödeme (vade)', width: 115, input: true, date: true,
        note: 'Ekstredeki SON ÖDEME tarihi (hesap kesim tarihi değil). Tahmini tarihi ekstreye göre düzeltebilirsiniz.',
        rule: function () { return dateRule_(); } },
      { key: 'tutar', title: 'Tutar', width: 110, input: true, money: true,
        note: 'Dönem borcu / taksit tutarı. Bilinmiyorsa boş kalabilir. Bildirim başlığında hiçbir zaman gösterilmez.',
        rule: function () { return SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).setHelpText('Tutar (ör. 12.345,67). Bilinmiyorsa boş bırakın.').build(); } },
      { key: 'paraBirimi', title: 'Para birimi', width: 80,
        rule: function () { return listRule_(PARA_BIRIMLERI, 'Para birimi'); } },
      { key: 'teyit', title: 'Tarih teyidi', width: 95,
        note: 'Tahmini: "Ekstreyi kontrol et" hatırlatması.\nTeyitli: ekstredeki tarihi girdiniz → "Kart ödemesi" hatırlatması.',
        rule: function () { return listRule_([TAHMINI, TEYITLI], 'Ekstredeki tarihi girdiyseniz Teyitli seçin'); } },
      { key: 'odendi', title: 'Ödendi', width: 70,
        note: 'İşaretleyince satır geçmiş olarak kalır, etkinliğin kalan bildirimleri kaldırılır. Yanlışlıkla işaretlediyseniz kaldırın: gelecekteki hatırlatmalar geri gelir.',
        rule: function () { return SpreadsheetApp.newDataValidation().requireCheckbox().build(); } },
      { key: 'takvim', title: 'Takvim durumu', width: 230, auto: true,
        note: 'Otomatik. "Takvimde ✓" eşitlendi demektir. HATA yazıyorsa ayrıntı buradadır; eşitleme kendiliğinden yeniden dener.' },
      { key: 'odemeTarihi', title: 'Ödendiği gün', width: 105, date: true,
        note: 'Ödendi işaretlenince bugünün tarihi yazılır; değiştirebilirsiniz.',
        rule: function () { return dateRule_(); } },
      { key: 'tur', title: 'Tür', width: 60, auto: true },
      { key: 'kimlik', title: 'Kimlik', tech: true, text: true },
      { key: 'kaynak', title: 'Kaynak kimliği', tech: true, text: true },
      { key: 'anahtar', title: 'Dönem anahtarı', tech: true, text: true },
      { key: 'olusturma', title: 'Oluşturan', tech: true, text: true },
      { key: 'sistemVade', title: 'Sistem vadesi', tech: true, date: true },
      { key: 'sistemTutar', title: 'Sistem tutarı', tech: true },
      { key: 'imza', title: 'Eşitleme imzası', tech: true, text: true },
      { key: 'esitlenen', title: 'Takvimdeki hal', tech: true, text: true },
    ],
  },
};

/** Ayarlar sekmesi: A sütunu ayarın adı, B sütunu değeri, C sütunu açıklama. */
var AYARLAR = [
  { key: 'saat', title: 'Bildirim saati', def: '10:00', kind: 'time',
    help: 'Etkinliğin vade günü başlayacağı saat (ör. 10:00). Değişince tüm açık etkinlikler güncellenir.' },
  { key: 'tutarAciklama', title: 'Etkinlik açıklamasında tutar', def: 'Evet', kind: 'yesno',
    help: 'Evet: tutar etkinliğin açıklamasında yazar. Başlıkta (bildirimde) tutar hiçbir zaman yer almaz.' },
  { key: 'siralama', title: 'Ödemeler her sabah sıralansın', def: 'Evet', kind: 'yesno',
    help: 'Evet: her sabah ödenmemişler vadeye göre üste, ödenenler alta dizilir.' },
  { key: 'testDakika', title: 'Test bildirimi kaç dakika sonra', def: 5, kind: 'minutes', help: '1–120 dakika.' },
  { key: 'testOlustur', title: 'Test bildirimi oluştur', def: false, kind: 'checkbox',
    help: 'İşaretleyin: yukarıdaki dakika kadar sonrasına silinebilir bir test etkinliği açılır. Kutu kendiliğinden boşalır.' },
  { key: 'testSil', title: 'Test etkinliklerini sil', def: false, kind: 'checkbox',
    help: 'İşaretleyin: tüm test etkinlikleri silinir. Bir günden eski olanlar her sabah zaten silinir.' },
  { key: 'simdiEsitle', title: 'Şimdi tam eşitle', def: false, kind: 'checkbox',
    help: 'İşaretleyin: günlük eşitlemeyi beklemeden tam eşitleme çalışır.' },
  { key: 'takvimKimligi', title: 'Takvim kimliği', def: '', kind: 'readonly', help: '"Ödemelerim" takviminin kimliği (yedek). Değiştirmeyin.' },
  { key: 'sonEsitleme', title: 'Son eşitleme', def: '', kind: 'readonly', help: 'Otomatik.' },
  { key: 'sonGunluk', title: 'Son günlük eşitleme', def: '', kind: 'readonly', help: 'Otomatik; her sabah 06.00 civarı.' },
  { key: 'sonHata', title: 'Son hata', def: '—', kind: 'readonly', help: 'Otomatik. Eşitlemenin tamamı başarısız olursa burada görünür.' },
  { key: 'testSonucu', title: 'Test sonucu', def: '', kind: 'readonly', help: 'Otomatik.' },
  { key: 'saglik', title: 'Sağlık kontrolü', def: '', kind: 'readonly', help: 'Editörde saglikKontrolu çalıştırınca dolar.' },
  { key: 'surum', title: 'Sürüm', def: SURUM, kind: 'readonly', help: '' },
];

// ===========================================================================
// 2) Editörden çalıştırılan işlevler
// ===========================================================================

/**
 * TEK SEFERLİK KURULUM. Sekmeleri, açılır listeleri, onay kutularını, "Ödemelerim" takvimini
 * ve tetikleyicileri hazırlar, ardından tam eşitleme yapar. Tekrar çalıştırmak güvenlidir:
 * veri silinmez; mükerrer takvim, etkinlik veya tetikleyici oluşmaz.
 */
function kurulum() {
  checkAdvancedService_();
  const ss = activeSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let calId;
  try {
    ss.setSpreadsheetTimeZone(TZ);
    try { ss.setSpreadsheetLocale('tr_TR'); } catch (e) { /* yerel ayar zorunlu değil */ }
    prepareSheets_(ss);
    calId = ensureCalendar_(ss);
    installTriggers_(ss);
    setSetting_(ss, 'surum', SURUM);
  } finally {
    lock.releaseLock();
  }
  const res = sync_({ full: true });
  const msg = 'Kurulum tamam. Takvim: "' + TAKVIM_ADI + '" (' + calId + '). Tetikleyiciler: ' +
    TETIKLEYICILER.join(', ') + '. ' + (res && res.summary ? res.summary : '');
  Logger.log(msg);
  return msg;
}

/**
 * iPhone bildirimini denemek için birkaç dakika sonrasına silinebilir bir test etkinliği açar.
 * Dakika verilmezse Ayarlar'daki "Test bildirimi kaç dakika sonra" (varsayılan 5) kullanılır.
 * Etkinlikte tek popup hatırlatma vardır: başlangıç anında (0 dk) — gerçek ödemelerdeki ile aynı.
 */
function testBildirimiOlustur(dakika) {
  checkAdvancedService_();
  const ss = activeSpreadsheet_();
  CELL_TZ = ss.getSpreadsheetTimeZone() || TZ;
  const settings = readSettings_(ss);
  let dk = Number(dakika);
  if (!isFinite(dk) || dk <= 0) dk = settings.testDakika;
  dk = Math.max(1, Math.min(120, Math.round(dk)));
  try {
    const calId = ensureCalendar_(ss);
    const startMs = Math.ceil((now_().getTime() + dk * 60000) / 60000) * 60000;
    const start = new Date(startMs);
    const end = new Date(startMs + 10 * 60000);
    const ev = api_(function () {
      return Calendar.Events.insert({
        summary: 'Test bildirimi · Ödeme Takvimi',
        description: 'Deneme etkinliği. Bu saatte telefonunuza bildirim geldiyse kurulum tamamdır.\n' +
          'Silmek için: Ayarlar sekmesinde "Test etkinliklerini sil" kutusunu işaretleyin ya da takvimden silin.',
        start: { dateTime: Utilities.formatDate(start, TZ, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
        end: { dateTime: Utilities.formatDate(end, TZ, "yyyy-MM-dd'T'HH:mm:ss"), timeZone: TZ },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
        colorId: RENK.test,
        transparency: 'transparent',
        visibility: 'private',
        extendedProperties: { private: { app: UYGULAMA, tur: 'test' } },
      }, calId);
    });
    const msg = 'Test etkinliği ' + Utilities.formatDate(start, TZ, 'dd.MM.yyyy HH:mm') + ' için açıldı (' + dk +
      ' dk sonra). O saatte telefonunuza "Test bildirimi · Ödeme Takvimi" bildirimi gelmeli.';
    setSetting_(ss, 'testSonucu', msg);
    Logger.log(msg);
    return { id: ev.id, start: start, mesaj: msg };
  } catch (e) {
    setSetting_(ss, 'testSonucu', 'HATA: ' + errText_(e) + ' · ' + stamp_(now_(), 'dd.MM.yyyy HH:mm'));
    throw e;
  }
}

/** Bu uygulamanın açtığı tüm test etkinliklerini siler. Ödeme etkinliklerine dokunmaz. */
function testEtkinlikleriniSil() {
  checkAdvancedService_();
  const ss = activeSpreadsheet_();
  const calId = storedCalendarId_(ss);
  if (!calId) throw new Error('Takvim kimliği yok. Önce kurulum işlevini çalıştırın.');
  let n = 0;
  listManaged_(calId).forEach(function (ev) {
    if (privOf_(ev).tur !== 'test') return;
    try { api_(function () { Calendar.Events.remove(calId, ev.id); }); n++; } catch (e) { if (!isGone_(e)) throw e; }
  });
  const msg = n + ' test etkinliği silindi · ' + stamp_(now_(), 'dd.MM.yyyy HH:mm');
  setSetting_(ss, 'testSonucu', msg);
  Logger.log(msg);
  return n;
}

/** Tam eşitleme: takvimi tabloyla karşılaştırır, eksik etkinliği geri getirir, artığı siler. */
function simdiEsitle() {
  const res = sync_({ full: true });
  Logger.log(res && res.summary);
  return res && res.summary;
}

/**
 * Gerçek Google hesabında kabul denetimi: tetikleyiciler tek mi, takvim ve saat dilimi doğru mu,
 * her eşitlenmiş satırın tek etkinliği var mı, hatırlatmalar kurala uyuyor mu, başlıkta tutar var mı.
 * Sonucu Ayarlar → "Sağlık kontrolü" satırına ve yürütme günlüğüne yazar.
 */
function saglikKontrolu() {
  checkAdvancedService_();
  const ss = activeSpreadsheet_();
  CELL_TZ = ss.getSpreadsheetTimeZone() || TZ;
  const now = now_();
  const lines = [];
  let sorun = 0;
  const check = function (cond, text) { lines.push((cond ? '✓ ' : '✗ ') + text); if (!cond) sorun++; };

  const counts = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    counts[f] = (counts[f] || 0) + 1;
  });
  TETIKLEYICILER.forEach(function (f) { check(counts[f] === 1, 'Tetikleyici ' + f + ': ' + (counts[f] || 0) + ' adet (beklenen 1)'); });

  const calId = storedCalendarId_(ss);
  check(!!calId, 'Takvim kimliği kayıtlı');
  let cal = null;
  if (calId) { try { cal = Calendar.Calendars.get(calId); } catch (e) { cal = null; } }
  check(!!cal, 'Takvim erişilebilir: ' + (cal ? cal.summary : '—'));
  if (cal) {
    check(cal.timeZone === TZ, 'Takvim saat dilimi: ' + cal.timeZone);
    const events = listManaged_(calId);
    const byId = {};
    events.forEach(function (ev) { byId[ev.id] = ev; });
    const pays = readTable_(ss, 'odemeler');
    const known = {};
    let acik = 0, ikiHatirlatma = 0, odendi = 0, eksik = 0, kuralDisi = 0, satirSorunu = 0, tutarBaslikta = 0;
    pays.rows.forEach(function (r) {
      if (r.empty) return;
      const id = str_(r.val.kimlik);
      if (!id) return;
      const evId = eventIdFor_(id);
      known[evId] = true;
      if (/^(HATA|Eksik|Bekliyor)/.test(str_(r.val.takvim))) satirSorunu++;
      const synced = parseSynced_(str_(r.val.esitlenen));
      if (!synced.state) return;
      const ev = byId[evId];
      if (!ev) { if (synced.state === 'acik') eksik++; return; }
      const rem = ev.reminders || {};
      const ov = rem.overrides || [];
      if (/\d\s*(TL|TRY|USD|EUR|GBP|₺)|\d[.,]\d{2}\b/i.test(ev.summary || '')) tutarBaslikta++;
      if (toBool_(r.val.odendi)) {
        odendi++;
        if (rem.useDefault || ov.length) kuralDisi++;
        return;
      }
      acik++;
      const mins = ov.map(function (o) { return o.method === 'popup' ? o.minutes : -1; }).sort(function (a, b) { return a - b; });
      const startMs = localToMs_(synced.start);
      const mustHaveBoth = startMs - HATIRLATMA_DK[0] * 60000 > now.getTime();
      const okSet = !rem.useDefault && mins.every(function (m) { return HATIRLATMA_DK.indexOf(m) >= 0; }) &&
        mins.length <= 2 && (mins.length < 2 || mins[0] !== mins[1]);
      if (!okSet || (mustHaveBoth && mins.length !== 2)) kuralDisi++;
      if (mins.length === 2) ikiHatirlatma++;
    });
    const artik = events.filter(function (ev) { return privOf_(ev).tur === 'odeme' && !known[ev.id]; }).length;
    const test = events.filter(function (ev) { return privOf_(ev).tur === 'test'; }).length;
    check(eksik === 0, 'Takvimde eksik açık ödeme etkinliği: ' + eksik);
    check(kuralDisi === 0, 'Hatırlatma kuralına uymayan etkinlik (açık: 2880 ve 0 dk popup, ödendi: hiç): ' + kuralDisi);
    check(artik === 0, 'Tabloda karşılığı olmayan ödeme etkinliği: ' + artik);
    check(tutarBaslikta === 0, 'Başlığında tutar geçen etkinlik: ' + tutarBaslikta);
    check(satirSorunu === 0, '"Takvim durumu" HATA/Eksik/Bekliyor gösteren satır: ' + satirSorunu);
    lines.push('Açık ödeme etkinliği: ' + acik + ' (iki hatırlatmalı: ' + ikiHatirlatma + ') · ödenmiş: ' + odendi + ' · test: ' + test);
  }
  const ozet = stamp_(now, 'dd.MM.yyyy HH:mm') + (sorun ? ' · ⚠ ' + sorun + ' sorun: ' +
    lines.filter(function (l) { return l.indexOf('✗') === 0; }).join(' | ') : ' · sorun yok');
  setSetting_(ss, 'saglik', ozet);
  const out = lines.join('\n');
  Logger.log(out);
  return out;
}

/** Tetikleyicileri kaldırır. Tablo ve "Ödemelerim" takvimi yerinde kalır. */
function kaldir() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TETIKLEYICILER.concat([DEVAM_TETIKLEYICISI]).indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  const msg = n + ' tetikleyici kaldırıldı. Tablo ve "' + TAKVIM_ADI + '" takvimi duruyor. Takvimi de silmek isterseniz: ' +
    'Google Takvim (bilgisayar) → Ayarlar → ' + TAKVIM_ADI + ' → Takvimi kaldır.';
  Logger.log(msg);
  return msg;
}

// ===========================================================================
// 3) Tetikleyici işleyicileri (kurulum oluşturur; elle çalıştırmanız gerekmez)
// ===========================================================================

/** Kurulabilir "düzenlemede" tetikleyicisi: telefondan yapılan düzenlemeyi takvime aktarır. */
function duzenlemedeEsitle(e) {
  const sheet = e && e.range && e.range.getSheet ? e.range.getSheet() : null;
  if (!sheet) return;
  const name = sheet.getName();
  if (ourSheetNames_().indexOf(name) < 0) return;
  markEdit_();
  if (name === AYAR_SAYFASI && runSettingActions_()) return;
  sync_({ full: false });
}

/** Kurulabilir "değişiklikte" tetikleyicisi: satır silinince artık etkinliği hemen kaldırır. */
function degisiklikteEsitle(e) {
  const type = e && e.changeType;
  if (type !== 'REMOVE_ROW' && type !== 'REMOVE_GRID') return;
  markEdit_();
  sync_({ full: true });
}

/** Günlük tam eşitleme: dönemleri ilerletir, kaçan değişiklikleri tamamlar, sıralar, eskiyen testleri siler. */
function gunlukEsitle() {
  sync_({ full: true, daily: true });
}

/** Zaman bütçesi aşıldığında bir kez kurulan devam tetikleyicisi. */
function devamEsitle() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === DEVAM_TETIKLEYICISI) ScriptApp.deleteTrigger(t);
  });
  sync_({ full: true });
}

// ===========================================================================
// 4) Eşitleme motoru
// ===========================================================================

function sync_(opts) {
  opts = opts || {};
  checkAdvancedService_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(opts.lockWaitMs || 25000)) return { skipped: true, summary: 'Başka bir eşitleme sürüyor; o tamamlayacak.' };
  const startMs = Date.now();
  let result = null;
  try {
    // Eşitleme sürerken yeni düzenleme gelirse (veya satırlar kaydıysa) aynı kilit altında bir tur daha.
    for (let round = 0; round < 3; round++) {
      const seq = props_().getProperty('editSeq') || '';
      result = syncOnce_(opts, startMs);
      if (result.outOfTime) break;
      if (!result.conflict && (props_().getProperty('editSeq') || '') === seq) break;
    }
  } catch (e) {
    try { setSetting_(activeSpreadsheet_(), 'sonHata', stamp_(now_(), 'dd.MM.yyyy HH:mm') + ' · ' + errText_(e)); } catch (ignore) { /* yok say */ }
    throw e;
  } finally {
    lock.releaseLock();
  }
  if (result && result.outOfTime) scheduleContinuation_();
  return result;
}

function syncOnce_(opts, startMs) {
  const ss = activeSpreadsheet_();
  CELL_TZ = ss.getSpreadsheetTimeZone() || TZ;
  const settings = readSettings_(ss);
  const ctx = {
    ss: ss, settings: settings, full: !!opts.full, daily: !!opts.daily, startMs: startMs,
    now: now_(), url: ss.getUrl(),
    stats: { yazilan: 0, hata: 0, olusan: 0, silinen: 0, bekleyen: 0 },
    outOfTime: false, conflict: false, warnings: settings.warnings.slice(),
  };
  ctx.today = Utilities.formatDate(ctx.now, TZ, 'yyyy-MM-dd');
  ctx.calId = ctx.full ? ensureCalendar_(ss) : (storedCalendarId_(ss) || ensureCalendar_(ss));

  const cards = readTable_(ss, 'kartlar');
  const loans = readTable_(ss, 'krediler');
  const pays = readTable_(ss, 'odemeler');

  const sources = normalizeSources_(cards, loans);
  normalizePayments_(pays, sources, ctx);
  generateCardPeriods_(pays, sources, ctx);
  applyLoanPlans_(pays, sources, ctx);
  markDuplicatePeriods_(pays);

  const existing = ctx.full ? indexEvents_(listManaged_(ctx.calId)) : null;
  syncEvents_(pays, existing, ctx);

  writeTable_(cards, ctx);
  writeTable_(loans, ctx);
  writeTable_(pays, ctx);
  updateNameValidation_(pays, sources, ctx.full);

  if (existing) {
    cleanupOrphans_(pays, existing, ctx);
    cleanupTestEvents_(existing, ctx);
  }
  if (ctx.daily && settings.siralama && !ctx.conflict) sortPayments_(ss);

  const st = ctx.stats;
  const summary = stamp_(ctx.now, 'dd.MM.yyyy HH:mm') + ' · ' + (ctx.full ? 'tam' : 'hızlı') + ' eşitleme · ' +
    st.yazilan + ' etkinlik yazıldı' +
    (st.olusan ? ' · ' + st.olusan + ' yeni kayıt' : '') +
    (st.silinen ? ' · ' + st.silinen + ' kayıt/etkinlik silindi' : '') +
    (st.bekleyen ? ' · ' + st.bekleyen + ' satır bekliyor (devam edecek)' : '') +
    (st.hata ? ' · ⚠ ' + st.hata + ' hata (Ödemeler → Takvim durumu)' : ' · hata yok') +
    (ctx.warnings.length ? ' · ⚠ ' + ctx.warnings.join(' · ') : '');
  setSetting_(ss, 'sonEsitleme', summary);
  if (ctx.daily) setSetting_(ss, 'sonGunluk', stamp_(ctx.now, 'dd.MM.yyyy HH:mm'));
  setSetting_(ss, 'sonHata', '—');
  return { stats: st, outOfTime: ctx.outOfTime, conflict: ctx.conflict, summary: summary };
}

// --- Kaynaklar (Kartlar, Krediler) ------------------------------------------

function normalizeSources_(cards, loans) {
  const out = { byId: {}, byName: {}, list: [] };
  const usedIds = {};
  const takeId = function (t, r, prefix) {
    let id = str_(r.val.kimlik);
    if (!id || usedIds[id]) {
      const copied = !!id;
      id = prefix + uuidHex_(12);
      set_(r, 'kimlik', id);
      if (copied && t.key === 'kartlar') set_(r, 'sonDonem', '');
      if (copied && t.key === 'krediler') set_(r, 'planImzasi', '');
    }
    usedIds[id] = true;
    return id;
  };
  const register = function (r, src, label) {
    if (!src.ad) { set_(r, 'bilgi', 'HATA: ' + label + ' adı boş.'); return false; }
    const nk = nameKey_(src.ad);
    if (out.byName[nk]) {
      set_(r, 'bilgi', 'HATA: "' + src.ad + '" adı başka bir satırda da var. Kart ve kredi adları birbirinden farklı olmalı.');
      return false;
    }
    out.byName[nk] = src;
    out.byId[src.id] = src;
    out.list.push(src);
    return true;
  };

  cards.rows.forEach(function (r) {
    if (r.empty) return;
    if (['ad', 'gun', 'durum'].every(function (k) { return isEmpty_(r.val[k]); })) { set_(r, 'bilgi', ''); return; }
    const src = { id: takeId(cards, r, 'k'), tur: TUR_KART, ad: str_(r.val.ad), row: r };
    if (!register(r, src, 'Kart')) return;
    let durum = str_(r.val.durum);
    if (!durum) { durum = AKTIF; set_(r, 'durum', AKTIF); }
    src.aktif = trLower_(durum) !== trLower_(PASIF);
    src.gun = parseDay_(r.val.gun);
    if (src.gun === null) set_(r, 'bilgi', 'HATA: Olağan son ödeme günü 1–31 arası bir sayı olmalı (ya da boş).');
  });

  loans.rows.forEach(function (r) {
    if (r.empty) return;
    if (['ad', 'ilkTarih', 'kalan', 'tutar'].every(function (k) { return isEmpty_(r.val[k]); })) { set_(r, 'bilgi', ''); return; }
    const src = { id: takeId(loans, r, 'c'), tur: TUR_KREDI, ad: str_(r.val.ad), row: r };
    if (!register(r, src, 'Kredi')) return;
    src.ilkTarih = cellToYmd_(r.val.ilkTarih);
    src.kalan = parseCount_(r.val.kalan);
    src.tutar = parseAmount_(r.val.tutar);
    let pb = str_(r.val.paraBirimi).toUpperCase();
    if (!pb) { pb = 'TRY'; set_(r, 'paraBirimi', 'TRY'); }
    src.pb = pb;
    let err = '';
    if (src.ilkTarih === '') err = 'Eksik: sıradaki taksit tarihini girin.';
    else if (src.ilkTarih === null) err = 'HATA: Taksit tarihi anlaşılamadı (ör. 31.01.2027).';
    else if (src.kalan === '') err = 'Eksik: kalan taksit sayısını (bu taksit dahil) girin.';
    else if (src.kalan === null) err = 'HATA: Kalan taksit 0 veya pozitif bir tam sayı olmalı.';
    else if (src.tutar === null) err = 'HATA: Aylık taksit tutarı sayı olmalı (ör. 4.250,00). Bilinmiyorsa boş bırakın.';
    src.valid = !err;
    if (err) set_(r, 'bilgi', err);
  });
  return out;
}

// --- Ödeme satırlarını düzenle --------------------------------------------------

function normalizePayments_(t, sources, ctx) {
  const used = {};
  t.rows.forEach(function (r) {
    r.err = '';
    const blank = ['ad', 'donem', 'vade', 'tutar'].every(function (k) { return isEmpty_(r.val[k]); }) && !toBool_(r.val.odendi);
    if (blank) {
      r.blank = true;
      r.clearTech = !isEmpty_(r.val.kimlik) || !isEmpty_(r.val.esitlenen);
      return;
    }
    let id = str_(r.val.kimlik);
    if (!id || used[id]) {
      const copied = !!id; // kopyala-yapıştır: yeni kayıt sayılır
      id = 'elle-' + uuidHex_(16);
      set_(r, 'kimlik', id);
      set_(r, 'olusturma', ELLE);
      if (copied) ['imza', 'esitlenen', 'sistemVade', 'sistemTutar'].forEach(function (k) { set_(r, k, ''); });
    }
    used[id] = true;
    if (isEmpty_(r.val.olusturma)) set_(r, 'olusturma', ELLE);

    resolveSource_(r, sources);
    if (r.err) return;
    const tur = str_(r.val.tur);

    if (isEmpty_(r.val.paraBirimi)) set_(r, 'paraBirimi', 'TRY');
    if (isEmpty_(r.val.teyit)) set_(r, 'teyit', tur === TUR_KART ? TAHMINI : TEYITLI);
    const paid = toBool_(r.val.odendi);
    if (r.val.odendi !== paid) set_(r, 'odendi', paid);
    const prevState = parseSynced_(str_(r.val.esitlenen)).state;
    if (paid && isEmpty_(r.val.odemeTarihi)) set_(r, 'odemeTarihi', ymdToCell_(ctx.today));
    if (!paid && prevState === 'odendi' && !isEmpty_(r.val.odemeTarihi)) set_(r, 'odemeTarihi', '');

    const vade = cellToYmd_(r.val.vade);
    if (vade === null) r.err = 'HATA: Vade tarihi anlaşılamadı. gg.aa.yyyy biçiminde girin (ör. 15.11.2026).';
    if (!r.err && parseAmount_(r.val.tutar) === null) r.err = 'HATA: Tutar sayı olmalı (ör. 12.345,67). Bilinmiyorsa boş bırakın.';

    if (tur === TUR_KART) {
      const typed = parsePeriod_(r.val.donem);
      if (typed === null) {
        if (!r.err) r.err = 'HATA: Dönem anlaşılamadı. "Kasım 2026" gibi yazın ya da boş bırakın.';
      } else {
        const key = typed || periodKey_(r.val.anahtar) || (vade ? periodOf_(vade) : '');
        if (key) {
          set_(r, 'anahtar', key);
          set_(r, 'donem', periodLabel_(key));
        }
      }
    } else if (tur === TUR_KREDI) {
      if (!periodKey_(r.val.anahtar)) {
        const base = cellToYmd_(r.val.sistemVade) || vade;
        if (base) set_(r, 'anahtar', periodOf_(base));
      }
      if (isEmpty_(r.val.donem) && periodKey_(r.val.anahtar)) set_(r, 'donem', periodLabel_(periodKey_(r.val.anahtar)));
    }
    if (!r.err && !vade) r.err = 'Eksik: son ödeme tarihini (vade) girin.';
  });
}

/** Satırın hangi kart/krediye ait olduğunu Kaynak kimliği ve ada göre bulur; yeniden adlandırmayı yansıtır. */
function resolveSource_(r, sources) {
  const ad = str_(r.val.ad);
  if (!ad) { r.err = 'Eksik: kart/kredi adını seçin.'; return; } // kullanıcı adı sildi: geri yazma
  const byName = sources.byName[nameKey_(ad)] || null;
  let src = sources.byId[str_(r.val.kaynak)] || null;
  if (byName && (!src || byName.id !== src.id)) {
    src = byName; // satır kullanıcı tarafından başka bir karta/krediye bağlandı (ya da ilk kez bağlanıyor)
    set_(r, 'kaynak', src.id);
  }
  if (src) {
    set_(r, 'ad', src.ad); // yeniden adlandırma veya büyük/küçük harf farkı
    set_(r, 'tur', src.tur);
    return;
  }
  const tur = str_(r.val.tur);
  if (str_(r.val.kaynak) && (tur === TUR_KART || tur === TUR_KREDI)) return; // kaynağı silinmiş eski kayıt: olduğu gibi kalır
  r.err = 'HATA: "' + ad + '" adında kart veya kredi yok. Önce Kartlar ya da Krediler sekmesine ekleyin.';
}

// --- Kredi kartı: dönemleri ilerlet ----------------------------------------------

function generateCardPeriods_(pays, sources, ctx) {
  sources.list.forEach(function (src) {
    if (src.tur !== TUR_KART) return;
    const r = src.row;
    if (src.gun === null) return; // hata Bilgi'de
    if (!src.aktif) { set_(r, 'bilgi', 'Pasif · yeni tahmini kayıt açılmaz.'); return; }
    if (src.gun === '') { set_(r, 'bilgi', 'Olağan gün yok · ekstreyi Ödemeler sekmesine elle ekleyin.'); return; }
    const rowsOf = payRowsOf_(pays, src.id);

    // Olağan gün değiştiyse: dokunulmamış, teyitsiz, ödenmemiş tahmini kayıtların tarihini yeni güne çek.
    rowsOf.forEach(function (p) {
      if (str_(p.val.olusturma) !== OTO || toBool_(p.val.odendi) || normTeyit_(p.val.teyit) === TEYITLI) return;
      const key = periodKey_(p.val.anahtar);
      const v = cellToYmd_(p.val.vade);
      if (!key || !v || v !== cellToYmd_(p.val.sistemVade)) return; // kullanıcı tarihi değiştirmiş: dokunma
      const nd = dueForPeriod_(key, src.gun);
      if (nd !== v) {
        set_(p, 'vade', ymdToCell_(nd));
        set_(p, 'sistemVade', ymdToCell_(nd));
      }
    });

    // Açık dönem: vadesi bugün veya sonra olan ilk dönem. Her dönem için en fazla bir kayıt.
    const target = targetPeriod_(ctx.today, src.gun);
    const cursor = periodKey_(r.val.sonDonem);
    if (!cursor || cursor < target) {
      const exists = rowsOf.some(function (p) { return periodKey_(p.val.anahtar) === target; });
      if (!exists) {
        const due = dueForPeriod_(target, src.gun);
        newPayRow_(pays, {
          ad: src.ad, donem: periodLabel_(target), vade: ymdToCell_(due), tutar: '', paraBirimi: 'TRY',
          teyit: TAHMINI, odendi: false, tur: TUR_KART,
          kimlik: uniquePayId_(pays, 'kart-' + src.id + '-' + target.replace('-', '')),
          kaynak: src.id, anahtar: target, olusturma: OTO, sistemVade: ymdToCell_(due),
        });
        ctx.stats.olusan++;
      }
      set_(r, 'sonDonem', target);
    }
    set_(r, 'bilgi', 'Sıradaki tahmini son ödeme: ' + fmtYmd_(dueForPeriod_(target, src.gun)) + ' (' + periodLabel_(target) + ')');
  });
}

// --- Kredi: taksit planı ---------------------------------------------------------

function applyLoanPlans_(pays, sources, ctx) {
  sources.list.forEach(function (src) {
    if (src.tur !== TUR_KREDI || !src.valid) return;
    const r = src.row;
    const sig = 'p' + hash_([src.ilkTarih, src.kalan, src.tutar, src.pb].join('|'));
    if (str_(r.val.planImzasi) === sig) return; // plan değişmedi: kullanıcının satır düzeltmelerine dokunma

    const anchor = parseYmd_(src.ilkTarih).d;
    const plan = [];
    for (let i = 0; i < src.kalan; i++) {
      const date = addMonthsAnchored_(src.ilkTarih, i, anchor);
      plan.push({ key: periodOf_(date), date: date, seq: (i + 1) + '/' + src.kalan });
    }
    const rowsOf = payRowsOf_(pays, src.id);
    const byKey = {};
    rowsOf.forEach(function (p) { const k = periodKey_(p.val.anahtar); if (k && !byKey[k]) byKey[k] = p; });
    const inPlan = {};
    plan.forEach(function (it) {
      inPlan[it.key] = true;
      const p = byKey[it.key];
      if (!p) {
        newPayRow_(pays, {
          ad: src.ad, donem: it.seq, vade: ymdToCell_(it.date), tutar: src.tutar, paraBirimi: src.pb,
          teyit: TEYITLI, odendi: false, tur: TUR_KREDI,
          kimlik: uniquePayId_(pays, 'kredi-' + src.id + '-' + it.key.replace('-', '')),
          kaynak: src.id, anahtar: it.key, olusturma: OTO, sistemVade: ymdToCell_(it.date), sistemTutar: src.tutar,
        });
        ctx.stats.olusan++;
        return;
      }
      if (toBool_(p.val.odendi) || str_(p.val.olusturma) !== OTO) return; // geçmiş ve elle eklenen satır korunur
      if (cellToYmd_(p.val.vade) === cellToYmd_(p.val.sistemVade)) set_(p, 'vade', ymdToCell_(it.date));
      set_(p, 'sistemVade', ymdToCell_(it.date));
      if (sameAmount_(parseAmount_(p.val.tutar), parseAmount_(p.val.sistemTutar))) set_(p, 'tutar', src.tutar);
      set_(p, 'sistemTutar', src.tutar);
      set_(p, 'paraBirimi', src.pb);
      set_(p, 'donem', it.seq);
    });
    let kalanDisarida = 0;
    rowsOf.forEach(function (p) {
      if (inPlan[periodKey_(p.val.anahtar)] || toBool_(p.val.odendi)) return;
      const v = cellToYmd_(p.val.vade);
      const untouched = str_(p.val.olusturma) === OTO && v && v === cellToYmd_(p.val.sistemVade);
      if (untouched && v >= ctx.today) { markDeleted_(pays, p); ctx.stats.silinen++; } else kalanDisarida++;
    });
    const info = plan.length
      ? plan.length + ' taksit planlandı · ilk ' + fmtYmd_(plan[0].date) + ' · son ' + fmtYmd_(plan[plan.length - 1].date)
      : 'Kalan taksit 0 · gelecek taksit yok.';
    set_(r, 'bilgi', info + (kalanDisarida ? ' · ⚠ ' + kalanDisarida +
      ' ödenmemiş satır planın dışında kaldı (elle değiştirilmiş ya da geçmiş); Ödemeler sekmesinde kontrol edin.' : ''));
    set_(r, 'planImzasi', sig);
  });
}

/** Aynı kartın aynı ekstre dönemi için ikinci satır olamaz: sonradan gelen satır hata alır, etkinlik açılmaz. */
function markDuplicatePeriods_(t) {
  const groups = {};
  allRows_(t).forEach(function (r) {
    if (r.blank || r.deleted || r.err || str_(r.val.tur) !== TUR_KART) return;
    const k = periodKey_(r.val.anahtar), s = str_(r.val.kaynak);
    if (!k || !s) return;
    (groups[s + '|' + k] = groups[s + '|' + k] || []).push(r);
  });
  Object.keys(groups).forEach(function (g) {
    const list = groups[g];
    if (list.length < 2) return;
    const winner = list.filter(function (r) { return !!str_(r.val.imza); })[0] || list[0];
    const label = periodLabel_(periodKey_(winner.val.anahtar));
    list.forEach(function (r) {
      if (r === winner) return;
      r.err = 'HATA: ' + label + ' ekstresi için ' + (winner.rowNum ? winner.rowNum + '. satırda' : 'başka bir satırda') +
        ' zaten kayıt var. Bu satırı silin ya da dönemi düzeltin.';
    });
  });
}

// --- Takvime yaz ----------------------------------------------------------------

function syncEvents_(t, existing, ctx) {
  const rows = allRows_(t);
  rows.forEach(function (r) {
    if (r.deleted) { dropEvent_(r, existing, ctx); return; }
    if (r.blank && r.clearTech) {
      // Kullanıcı satırın içeriğini sildi: etkinliği kaldır, teknik ve otomatik hücreleri temizle.
      if (dropEvent_(r, existing, ctx)) {
        ['kimlik', 'kaynak', 'anahtar', 'olusturma', 'sistemVade', 'sistemTutar', 'imza', 'esitlenen',
          'takvim', 'tur', 'teyit', 'paraBirimi', 'odemeTarihi', 'odendi'].forEach(function (k) { set_(r, k, ''); });
      }
    }
  });

  const live = rows.filter(function (r) { return !r.deleted && !r.blank; });
  const rank = function (r) {
    if (r.err) return 0;
    if (toBool_(r.val.odendi)) return 3;
    return cellToYmd_(r.val.vade) >= ctx.today ? 1 : 2;
  };
  live.sort(function (a, b) {
    const d = rank(a) - rank(b);
    if (d) return d;
    const va = cellToYmd_(a.val.vade) || '9999', vb = cellToYmd_(b.val.vade) || '9999';
    return va < vb ? -1 : va > vb ? 1 : 0;
  });

  live.forEach(function (r) {
    if (r.err) {
      set_(r, 'takvim', r.err);
      if (dropEvent_(r, existing, ctx)) { set_(r, 'esitlenen', ''); set_(r, 'imza', ''); }
      return;
    }
    const d = desiredEvent_(r, ctx);
    const action = decide_(r, d, existing);
    if (action === 'skip') return;
    if (action === 'record') { markSynced_(r, d, ctx); return; }
    if (action === 'noevent') {
      set_(r, 'imza', d.sig);
      set_(r, 'takvim', 'Ödendi ✓ · takvime eklenmedi (eklendiğinde zaten ödenmişti)');
      return;
    }
    if (outOfTime_(ctx)) {
      ctx.outOfTime = true;
      ctx.stats.bekleyen++;
      set_(r, 'takvim', 'Bekliyor · birazdan otomatik yazılacak');
      return;
    }
    try {
      const ev = writeEvent_(ctx, r, d, action);
      if (existing && ev && ev.id) existing[ev.id] = ev;
      markSynced_(r, d, ctx);
      ctx.stats.yazilan++;
    } catch (e) {
      ctx.stats.hata++;
      set_(r, 'takvim', 'HATA: ' + errText_(e) + ' · ' + stamp_(ctx.now, 'dd.MM HH:mm') + ' · otomatik tekrar denenecek');
    }
  });
}

/** Satırın takvimdeki istenen hali. Başlıkta tutar yoktur. */
function desiredEvent_(r, ctx) {
  const v = r.val;
  const vade = cellToYmd_(v.vade);
  const tur = str_(v.tur);
  const ad = str_(v.ad);
  const paid = toBool_(v.odendi);
  const teyitli = normTeyit_(v.teyit) === TEYITLI;
  const tutar = parseAmount_(v.tutar);
  const pb = str_(v.paraBirimi) || 'TRY';
  let title = tur === TUR_KREDI ? 'Kredi taksiti · ' + ad : (teyitli ? 'Kart ödemesi · ' + ad : 'Ekstreyi kontrol et · ' + ad);
  if (paid) title = '✓ ' + title;
  const startMin = ctx.settings.saat.h * 60 + ctx.settings.saat.m;
  const startLocal = localTime_(vade, startMin);
  const endLocal = localTime_(vade, startMin + ETKINLIK_SURESI_DK);
  const lines = [];
  if (tur === TUR_KART) lines.push('Ekstre dönemi: ' + (periodLabel_(periodKey_(v.anahtar)) || '—'));
  else lines.push('Taksit: ' + (str_(v.donem) || '—'));
  if (ctx.settings.tutarAciklama) lines.push('Tutar: ' + (typeof tutar === 'number' ? formatMoney_(tutar, pb) : 'girilmedi'));
  if (tur === TUR_KART && !teyitli && !paid) {
    lines.push('Tarih tahminidir. Ekstre gelince son ödeme tarihini (ve biliyorsanız tutarı) Ödemeler sekmesine girip "Tarih teyidi"ni "Teyitli" yapın. Hesap kesim tarihini girmeyin.');
  }
  if (paid) {
    const od = cellToYmd_(v.odemeTarihi);
    lines.push('Ödendi olarak işaretlendi' + (od ? ' (' + fmtYmd_(od) + ')' : '') + '. Hatırlatma yok.');
  }
  lines.push('', 'Tablo: ' + ctx.url, 'Bu etkinliği Ödeme Takvimi yönetir; değişiklikleri tabloda yapın.');
  const description = lines.join('\n');
  const colorId = paid ? RENK.odendi : (tur === TUR_KREDI ? RENK.kredi : (teyitli ? RENK.teyitli : RENK.tahmini));
  const sig = 'h' + hash_(JSON.stringify([ctx.calId, title, startLocal, endLocal, description, colorId, paid ? 1 : 0]));
  return { title: title, startLocal: startLocal, endLocal: endLocal, description: description, colorId: colorId, paid: paid, sig: sig };
}

/** skip | record | noevent | insert | patch */
function decide_(r, d, existing) {
  const imza = str_(r.val.imza);
  const synced = str_(r.val.esitlenen);
  if (existing) {
    const ev = existing[eventIdFor_(str_(r.val.kimlik))];
    if (ev) {
      if (privOf_(ev).imza !== d.sig) return 'patch';
      return imza === d.sig && synced ? 'skip' : 'record';
    }
    if (d.paid) {
      if (imza === d.sig) return 'skip'; // ödenmiş ve takvimden silinmiş: geri getirmeye gerek yok
      return synced ? 'insert' : 'noevent';
    }
    return 'insert'; // açık ödemenin etkinliği yok (takvimden silinmiş olabilir): geri getir
  }
  if (imza === d.sig) return 'skip';
  if (d.paid && !synced) return 'noevent';
  return synced ? 'patch' : 'insert';
}

function markSynced_(r, d, ctx) {
  set_(r, 'imza', d.sig);
  set_(r, 'esitlenen', (d.paid ? 'odendi' : 'acik') + '|' + d.startLocal);
  set_(r, 'takvim', (d.paid ? 'Ödendi ✓ · bildirimler kapalı' : 'Takvimde ✓') + ' · ' + stamp_(ctx.now, 'dd.MM HH:mm'));
}

/**
 * Hatırlatma kuralı:
 *  - yeni etkinlik: açıksa tam iki popup (2880 ve 0 dk), ödenmişse hiç
 *  - açık → ödendi: hiç (kalan bildirimler kalkar)
 *  - ödendi → açık (işaret geri alındı): yalnızca zamanı henüz gelmemiş hatırlatmalar
 *  - açık ve tarih/saat değişti: tam iki popup
 *  - diğer değişiklikler (başlık, açıklama, renk): hatırlatmalara dokunulmaz
 * Varsayılan hatırlatmalar her zaman kapalıdır (useDefault: false).
 */
function remindersFor_(prev, d, now) {
  if (!prev.state) return d.paid ? remindersNone_() : remindersFull_();
  if (d.paid) return prev.state === 'odendi' ? null : remindersNone_();
  if (prev.state === 'odendi') {
    const startMs = localToMs_(d.startLocal);
    return {
      useDefault: false,
      overrides: HATIRLATMA_DK.filter(function (m) { return startMs - m * 60000 > now.getTime(); })
        .map(function (m) { return { method: 'popup', minutes: m }; }),
    };
  }
  if (prev.start !== d.startLocal) return remindersFull_();
  return null;
}

function remindersFull_() {
  return { useDefault: false, overrides: HATIRLATMA_DK.map(function (m) { return { method: 'popup', minutes: m }; }) };
}

function remindersNone_() { return { useDefault: false, overrides: [] }; }

function writeEvent_(ctx, r, d, action) {
  const pid = str_(r.val.kimlik);
  const id = eventIdFor_(pid);
  const prev = parseSynced_(str_(r.val.esitlenen));
  const body = {
    summary: d.title,
    description: d.description,
    start: { dateTime: d.startLocal, timeZone: TZ },
    end: { dateTime: d.endLocal, timeZone: TZ },
    colorId: d.colorId,
    transparency: 'transparent',
    visibility: 'private',
    status: 'confirmed',
    extendedProperties: { private: { app: UYGULAMA, tur: 'odeme', odemeId: pid, imza: d.sig } },
  };
  const createReminders = d.paid ? remindersNone_() : remindersFull_();
  // PATCH ile gönderilen hatırlatmalar (özellikle boş liste) yerine oturmadıysa etkinliği tam haliyle yeniden yaz.
  const ensureReminders = function (ev, wanted) {
    if (!wanted || !ev || sameReminders_(ev.reminders, wanted)) return ev;
    return api_(function () { return Calendar.Events.update(Object.assign({}, body, { reminders: wanted }), ctx.calId, id); });
  };
  const insert = function () {
    const b = Object.assign({ id: id }, body, { reminders: createReminders });
    let ev;
    try {
      ev = api_(function () { return Calendar.Events.insert(b, ctx.calId); });
    } catch (e) {
      if (!isConflict_(e)) throw e;
      // Bu kimlikle etkinlik zaten var (ör. silinmiş satır geri geldi): mükerrer açmak yerine onu güncelle/geri getir.
      ev = api_(function () { return Calendar.Events.patch(Object.assign({}, body, { reminders: createReminders }), ctx.calId, id); });
    }
    return ensureReminders(ev, createReminders);
  };
  if (action === 'insert' || !prev.state) return insert();
  const reminders = remindersFor_(prev, d, ctx.now);
  const b = Object.assign({}, body);
  if (reminders) b.reminders = reminders;
  let ev;
  try {
    ev = api_(function () { return Calendar.Events.patch(b, ctx.calId, id); });
  } catch (e) {
    if (isGone_(e)) return insert();
    throw e;
  }
  return ensureReminders(ev, reminders);
}

function sameReminders_(got, wanted) {
  got = got || {};
  const key = function (r) {
    return (r.overrides || []).map(function (o) { return o.method + ':' + o.minutes; }).sort().join(',');
  };
  return !got.useDefault === !wanted.useDefault && key(got) === key(wanted);
}

/** Satırın etkinliğini (varsa) kaldırır. Başarılıysa true döner. */
function dropEvent_(r, existing, ctx) {
  const pid = str_(r.val.kimlik);
  if (!pid) return true;
  const id = eventIdFor_(pid);
  const known = existing ? !!existing[id] : false;
  if (!known && !str_(r.val.esitlenen)) return true;
  if (outOfTime_(ctx)) { ctx.outOfTime = true; ctx.stats.bekleyen++; return false; }
  try {
    api_(function () { Calendar.Events.remove(ctx.calId, id); });
  } catch (e) {
    if (!isGone_(e)) {
      ctx.stats.hata++;
      if (!r.deleted) set_(r, 'takvim', (r.err || 'HATA') + ' · etkinlik silinemedi: ' + errText_(e));
      return false;
    }
  }
  if (existing) delete existing[id];
  ctx.stats.silinen++;
  return true;
}

function cleanupOrphans_(t, existing, ctx) {
  const ids = {};
  let rowsWithId = 0;
  allRows_(t).forEach(function (r) {
    if (r.deleted || r.blank) return;
    const pid = str_(r.val.kimlik);
    if (pid) { ids[eventIdFor_(pid)] = true; rowsWithId++; }
  });
  const orphans = Object.keys(existing).filter(function (id) { return privOf_(existing[id]).tur === 'odeme' && !ids[id]; });
  if (!rowsWithId && orphans.length > 3) {
    ctx.warnings.push('Ödemeler sekmesi boş göründüğü için takvimdeki ' + orphans.length + ' etkinlik güvenlik amacıyla silinmedi');
    return;
  }
  orphans.forEach(function (id) {
    if (outOfTime_(ctx)) { ctx.outOfTime = true; return; }
    try {
      api_(function () { Calendar.Events.remove(ctx.calId, id); });
      ctx.stats.silinen++;
    } catch (e) {
      if (!isGone_(e)) { ctx.stats.hata++; return; }
    }
    delete existing[id];
  });
}

function cleanupTestEvents_(existing, ctx) {
  const limit = ctx.now.getTime() - 24 * 3600 * 1000;
  Object.keys(existing).forEach(function (id) {
    const ev = existing[id];
    if (privOf_(ev).tur !== 'test') return;
    if (!(evEndMs_(ev) < limit)) return;
    try { api_(function () { Calendar.Events.remove(ctx.calId, id); }); } catch (e) { if (!isGone_(e)) return; }
    delete existing[id];
  });
}

function evEndMs_(ev) {
  const s = ev && ev.end && ev.end.dateTime;
  if (!s) return NaN;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return new Date(s).getTime();
  return localToMs_(s.slice(0, 19));
}

function outOfTime_(ctx) { return Date.now() - ctx.startMs > ZAMAN_BUTCESI_MS; }

// --- Takvim yardımcıları -----------------------------------------------------------

/**
 * Kayıtlı takvim kimliği. Kimlik bu tabloya bağlıdır: tablo "Kopya oluştur" ile çoğaltılıp kopyada kurulum
 * çalıştırılırsa kopya kendi takvimini açar; iki tablo aynı takvim için çekişmez.
 */
function storedCalendarId_(ss) {
  const p = props_();
  const owner = p.getProperty('takvimTablo');
  if (owner && owner !== ss.getId()) return '';
  return p.getProperty('takvimId') || str_(readSettingsRaw_(ss).takvimKimligi);
}

function saveCalendarId_(ss, id) {
  const p = props_();
  if (p.getProperty('takvimId') !== id) p.setProperty('takvimId', id);
  if (p.getProperty('takvimTablo') !== ss.getId()) p.setProperty('takvimTablo', ss.getId());
  setSetting_(ss, 'takvimKimligi', id);
}

/** "Ödemelerim" takvimini bulur; yoksa oluşturur. Kimlik hem betik özelliklerinde hem Ayarlar'da saklanır. */
function ensureCalendar_(ss) {
  const id = storedCalendarId_(ss);
  if (id) {
    try {
      const cal = api_(function () { return Calendar.Calendars.get(id); });
      if (cal && cal.timeZone !== TZ) api_(function () { return Calendar.Calendars.patch({ timeZone: TZ }, id); });
      saveCalendarId_(ss, id);
      return id;
    } catch (e) {
      if (!isGone_(e)) throw e; // geçici hatada yeni takvim açma
    }
  }
  const cal = api_(function () {
    return Calendar.Calendars.insert({
      summary: TAKVIM_ADI,
      timeZone: TZ,
      description: 'Kredi kartı ve kredi ödemeleri. Ödeme Takvimi tablosu yönetir; değişiklikleri tabloda yapın.',
    });
  });
  saveCalendarId_(ss, cal.id);
  return cal.id;
}

function listManaged_(calId) {
  const out = [];
  let pageToken = null;
  do {
    const opts = { privateExtendedProperty: 'app=' + UYGULAMA, maxResults: 2500, showDeleted: false };
    if (pageToken) opts.pageToken = pageToken;
    const resp = api_(function () { return Calendar.Events.list(calId, opts); });
    (resp.items || []).forEach(function (ev) { if (ev.status !== 'cancelled') out.push(ev); });
    pageToken = resp.nextPageToken || null;
  } while (pageToken);
  return out;
}

function indexEvents_(events) {
  const map = {};
  events.forEach(function (ev) { map[ev.id] = ev; });
  return map;
}

function privOf_(ev) {
  return (ev && ev.extendedProperties && ev.extendedProperties.private) || {};
}

/** Ödeme kimliğinden takvim etkinlik kimliği (yalnızca 0-9 ve a-v harfleri; Google kuralı). */
function eventIdFor_(pid) {
  let hex = '';
  for (let i = 0; i < pid.length; i++) {
    const c = pid.charCodeAt(i);
    hex += c < 256 ? ('0' + c.toString(16)).slice(-2) : 'g' + ('000' + c.toString(16)).slice(-4);
  }
  if (hex.length > 1000) hex = hash_(pid) + hash_(pid + '#');
  return 'odm' + hex;
}

function parseSynced_(s) {
  const i = s.indexOf('|');
  if (i < 0) return { state: '', start: '' };
  return { state: s.slice(0, i), start: s.slice(i + 1) };
}

/** Geçici hatalarda (hız sınırı, 5xx) üstel bekleme ile en fazla 3 kez yeniden dener. */
function api_(fn) {
  let delay = 500;
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (e) {
      if (attempt < 3 && isTransient_(e)) { Utilities.sleep(delay); delay *= 2; continue; }
      throw e;
    }
  }
}

function errCode_(e) {
  if (e && e.details && e.details.code) return Number(e.details.code);
  return 0;
}

function isConflict_(e) { return errCode_(e) === 409 || /already exists|duplicate/i.test(String(e && e.message)); }

function isGone_(e) {
  const c = errCode_(e);
  return c === 404 || c === 410 || /not found|has been deleted|notFound|deleted/i.test(String(e && e.message));
}

function isTransient_(e) {
  const c = errCode_(e);
  const msg = String(e && e.message);
  if (c === 429 || c >= 500) return true;
  return /rate limit|ratelimit|backend error|internal error|service unavailable|timed out|try again|usage limit/i.test(msg);
}

function errText_(e) {
  const msg = String((e && e.message) || e).replace(/^.*failed with error:\s*/i, '').replace(/\s+/g, ' ').trim();
  return msg.length > 140 ? msg.slice(0, 137) + '…' : msg;
}

// --- Tetikleyiciler -------------------------------------------------------------

/** Tetikleyicileri kurar; olanı yeniden kurmaz, fazlasını siler (iki kez çalıştırmak güvenli). */
function installTriggers_(ss) {
  const T = ScriptApp.EventType;
  const wanted = [
    { fn: 'duzenlemedeEsitle', type: T.ON_EDIT, make: function () { ScriptApp.newTrigger('duzenlemedeEsitle').forSpreadsheet(ss).onEdit().create(); } },
    { fn: 'degisiklikteEsitle', type: T.ON_CHANGE, make: function () { ScriptApp.newTrigger('degisiklikteEsitle').forSpreadsheet(ss).onChange().create(); } },
    { fn: 'gunlukEsitle', type: T.CLOCK, make: function () {
      ScriptApp.newTrigger('gunlukEsitle').timeBased().everyDays(1).atHour(GUNLUK_SAAT).nearMinute(10).inTimezone(TZ).create();
    } },
  ];
  const all = ScriptApp.getProjectTriggers();
  wanted.forEach(function (w) {
    const mine = all.filter(function (t) { return t.getHandlerFunction() === w.fn; });
    let keep = null;
    mine.forEach(function (t) {
      if (!keep && String(t.getEventType()) === String(w.type)) keep = t;
      else ScriptApp.deleteTrigger(t);
    });
    if (!keep) w.make();
  });
}

function scheduleContinuation_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === DEVAM_TETIKLEYICISI; });
  if (!has) ScriptApp.newTrigger(DEVAM_TETIKLEYICISI).timeBased().after(60 * 1000).create();
}

function markEdit_() {
  props_().setProperty('editSeq', String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8));
}

/** Ayarlar'daki onay kutuları (test oluştur/sil, şimdi eşitle). Bir işlem yapıldıysa true döner. */
function runSettingActions_() {
  const ss = activeSpreadsheet_();
  const raw = readSettingsRaw_(ss);
  let handled = false;
  if (toBool_(raw.testOlustur)) {
    setSetting_(ss, 'testOlustur', false);
    try { testBildirimiOlustur(); } catch (e) { /* hata Test sonucu satırında */ }
    handled = true;
  }
  if (toBool_(raw.testSil)) {
    setSetting_(ss, 'testSil', false);
    try { testEtkinlikleriniSil(); } catch (e) { setSetting_(ss, 'testSonucu', 'HATA: ' + errText_(e)); }
    handled = true;
  }
  if (toBool_(raw.simdiEsitle)) {
    setSetting_(ss, 'simdiEsitle', false);
    sync_({ full: true });
    handled = true;
  }
  return handled;
}

// ===========================================================================
// 5) Tablo yardımcıları
// ===========================================================================

function activeSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Bu betik bir Google E-Tablo içinden açılmalı: E-Tablo → Uzantılar → Apps Script.');
  return ss;
}

function checkAdvancedService_() {
  if (typeof Calendar === 'undefined' || !Calendar || !Calendar.Events) {
    throw new Error('Gelişmiş Google Takvim hizmeti açık değil. Editörde appsscript.json dosyasını README’deki gibi değiştirin ' +
      'ya da soldaki "Hizmetler +" → "Google Calendar API" → Ekle.');
  }
}

function props_() { return PropertiesService.getScriptProperties(); }

function now_() { return new Date(); }

function ourSheetNames_() {
  return [SPEC.kartlar.name, SPEC.krediler.name, SPEC.odemeler.name, AYAR_SAYFASI];
}

function readTable_(ss, key) {
  const spec = SPEC[key];
  const sh = ss.getSheetByName(spec.name);
  if (!sh) throw new Error('"' + spec.name + '" sekmesi bulunamadı. Apps Script editöründe kurulum işlevini çalıştırın.');
  const width = Math.max(sh.getLastColumn(), 1);
  const header = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  const colIdx = {};
  spec.cols.forEach(function (c) {
    const i = header.indexOf(c.title);
    if (i < 0) {
      throw new Error(spec.name + ' sekmesinde "' + c.title + '" başlığı yok. Başlıkları değiştirmeyin; düzeltmek için kurulum işlevini yeniden çalıştırın.');
    }
    colIdx[c.key] = i;
  });
  const lastRow = sh.getLastRow();
  const values = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, width).getValues() : [];
  const t = { key: key, spec: spec, sheet: sh, colIdx: colIdx, width: width, rows: [], newRows: [], deletions: [] };
  values.forEach(function (arr, i) {
    const r = { rowNum: i + 2, raw: {}, val: {}, changes: {}, isNew: false, empty: isArrEmpty_(arr) };
    spec.cols.forEach(function (c) { r.raw[c.key] = arr[colIdx[c.key]]; r.val[c.key] = arr[colIdx[c.key]]; });
    t.rows.push(r);
  });
  return t;
}

function allRows_(t) { return t.rows.concat(t.newRows); }

function payRowsOf_(t, srcId) {
  return allRows_(t).filter(function (p) { return !p.blank && !p.deleted && str_(p.val.kaynak) === srcId; });
}

function newPayRow_(t, values) {
  const r = { rowNum: null, raw: {}, val: {}, changes: {}, isNew: true, empty: false };
  t.spec.cols.forEach(function (c) { r.val[c.key] = ''; r.raw[c.key] = ''; });
  Object.keys(values).forEach(function (k) { r.val[k] = values[k]; });
  t.newRows.push(r);
  return r;
}

function uniquePayId_(t, base) {
  const used = {};
  allRows_(t).forEach(function (r) { const k = str_(r.val.kimlik); if (k) used[k] = true; });
  let id = base, n = 2;
  while (used[id]) id = base + '-' + (n++);
  return id;
}

function markDeleted_(t, r) {
  if (r.isNew) { t.newRows = t.newRows.filter(function (x) { return x !== r; }); return; }
  r.deleted = true;
  t.deletions.push(r);
}

/** Değeri değiştirir ve değiştiğini işaretler (aynıysa hiçbir şey yazılmaz). */
function set_(r, key, value) {
  if (sameCell_(r.val[key], value)) return false;
  r.val[key] = value;
  r.changes[key] = true;
  return true;
}

function sameCell_(a, b) {
  if (isDate_(a) || isDate_(b)) return isDate_(a) && isDate_(b) && cellToYmd_(a) === cellToYmd_(b); // tarih hücresi: gün yeter
  const ea = isEmpty_(a), eb = isEmpty_(b);
  if (ea || eb) return ea && eb;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a).trim() === String(b).trim();
}

/** Değişen hücreleri tek tek yazar. Yazmadan önce satırın yerinden kaymadığını denetler. */
function writeTable_(t, ctx) {
  const sh = t.sheet;
  const changed = t.rows.filter(function (r) { return !r.deleted && Object.keys(r.changes).length; });
  if (changed.length) {
    const fresh = currentIdentity_(t);
    changed.forEach(function (r) {
      const cur = fresh[r.rowNum - 2];
      if (!cur || !sameCell_(cur[0], r.raw.kimlik) || !sameCell_(cur[1], r.raw.ad)) { ctx.conflict = true; return; }
      Object.keys(r.changes).forEach(function (k) { sh.getRange(r.rowNum, t.colIdx[k] + 1).setValue(r.val[k]); });
    });
  }
  writeNewRows_(t);
  deleteRows_(t, ctx);
}

function currentIdentity_(t) {
  const sh = t.sheet;
  const last = sh.getLastRow();
  if (last < 2) return [];
  const ids = sh.getRange(2, t.colIdx.kimlik + 1, last - 1, 1).getValues();
  const ads = sh.getRange(2, t.colIdx.ad + 1, last - 1, 1).getValues();
  return ids.map(function (x, i) { return [x[0], ads[i][0]]; });
}

function lastDataRow_(t) {
  let last = 1;
  t.rows.forEach(function (r) { if (!r.empty && r.rowNum > last) last = r.rowNum; });
  return last;
}

/** Yeni satırları son dolu satırın altına yazar (onay kutusu sütunundaki FALSE değerleri "dolu" sayılmaz). */
function writeNewRows_(t) {
  if (!t.newRows.length) return;
  const sh = t.sheet;
  let target = lastDataRow_(t) + 1;
  t.newRows.forEach(function (r) {
    for (;;) {
      if (target > sh.getMaxRows()) {
        const oldMax = sh.getMaxRows();
        sh.insertRowsAfter(oldMax, 200);
        applyColumnRules_(sh, t.spec, t.colIdx, oldMax + 1, 200);
      }
      const probe = sh.getRange(target, 1, 1, t.width).getValues()[0];
      if (isArrEmpty_(probe)) break;
      target++;
    }
    const arr = [];
    for (let i = 0; i < t.width; i++) arr.push('');
    t.spec.cols.forEach(function (c) { const v = r.val[c.key]; arr[t.colIdx[c.key]] = v === undefined || v === null ? '' : v; });
    sh.getRange(target, 1, 1, t.width).setValues([arr]);
    r.rowNum = target;
    target++;
  });
}

function deleteRows_(t, ctx) {
  t.deletions.slice().sort(function (a, b) { return b.rowNum - a.rowNum; }).forEach(function (r) {
    const cur = t.sheet.getRange(r.rowNum, t.colIdx.kimlik + 1).getValue();
    if (!sameCell_(cur, r.raw.kimlik)) { ctx.conflict = true; return; }
    t.sheet.deleteRow(r.rowNum);
  });
}

function isArrEmpty_(arr) {
  return arr.every(function (v) { return isEmpty_(v) || v === false; });
}

/** Ödemeler'deki "Kart / kredi" açılır listesini Kartlar ve Krediler'deki adlarla günceller. */
function updateNameValidation_(pays, sources, force) {
  const names = sources.list.map(function (s) { return s.ad; });
  const key = names.join('\n');
  const p = props_();
  if (!force && p.getProperty('adListesi') === key) return;
  const sh = pays.sheet;
  const rng = sh.getRange(2, pays.colIdx.ad + 1, sh.getMaxRows() - 1, 1);
  if (names.length) {
    rng.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(names, true).setAllowInvalid(true)
      .setHelpText('Kartlar veya Krediler sekmesindeki bir adı seçin.').build());
  } else {
    rng.clearDataValidations();
  }
  p.setProperty('adListesi', key);
}

/**
 * Ödemeler'i dizer: önce ödenmemişler (vadeye göre), sonra ödenenler (yeniden eskiye), en altta boş satırlar.
 * Okuma ile yazma arasında tablo değiştiyse hiçbir şey yazmaz.
 */
function sortPayments_(ss) {
  const t = readTable_(ss, 'odemeler');
  const last = lastDataRow_(t);
  if (last < 3) return false;
  const range = t.sheet.getRange(2, 1, last - 1, t.width);
  const before = range.getValues();
  const ci = t.colIdx;
  const items = before.map(function (arr, i) {
    return { arr: arr, i: i, blank: isArrEmpty_(arr), paid: toBool_(arr[ci.odendi]), vade: cellToYmd_(arr[ci.vade]) || '' };
  });
  const sorted = items.slice().sort(function (a, b) {
    if (a.blank !== b.blank) return a.blank ? 1 : -1;
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    if (a.vade !== b.vade) {
      if (!a.vade) return 1;
      if (!b.vade) return -1;
      return (a.vade < b.vade ? -1 : 1) * (a.paid ? -1 : 1);
    }
    return a.i - b.i;
  });
  if (sorted.every(function (x, k) { return x.i === k; })) return false;
  const again = range.getValues();
  if (JSON.stringify(again) !== JSON.stringify(before)) return false;
  range.setValues(sorted.map(function (x) { return x.arr; }));
  return true;
}

// --- Sekmeleri hazırla (kurulum) ----------------------------------------------------

function prepareSheets_(ss) {
  ['kartlar', 'krediler', 'odemeler'].forEach(function (k) { prepareTable_(ss, SPEC[k]); });
  prepareSettings_(ss);
  removeEmptyDefaultSheet_(ss);
}

function prepareTable_(ss, spec) {
  const sh = ss.getSheetByName(spec.name) || ss.insertSheet(spec.name);
  ensureHeaders_(sh, spec.cols.map(function (c) { return c.title; }));
  if (sh.getMaxRows() < 1000) sh.insertRowsAfter(sh.getMaxRows(), 1000 - sh.getMaxRows());
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const colIdx = {};
  spec.cols.forEach(function (c) { colIdx[c.key] = header.indexOf(c.title); });
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#e8f0fe').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  if (spec.freezeCols) sh.setFrozenColumns(spec.freezeCols);
  let firstTech = true;
  spec.cols.forEach(function (c) {
    const col = colIdx[c.key] + 1;
    const head = sh.getRange(1, col);
    if (c.width) sh.setColumnWidth(col, c.width);
    if (c.auto) head.setBackground('#f1f3f4');
    if (c.tech) {
      head.setBackground('#fce8e6');
      if (firstTech) { head.setNote('Teknik sütunlar (gizli). Eşitleme bunlarla çalışır; değiştirmeyin.'); firstTech = false; }
      sh.hideColumns(col);
    } else if (c.note) {
      head.setNote(c.note);
    }
  });
  applyColumnRules_(sh, spec, colIdx, 2, sh.getMaxRows() - 1);
}

function applyColumnRules_(sh, spec, colIdx, fromRow, n) {
  spec.cols.forEach(function (c) {
    const rng = sh.getRange(fromRow, colIdx[c.key] + 1, n, 1);
    if (c.text) rng.setNumberFormat('@');
    if (c.date) rng.setNumberFormat('dd.mm.yyyy');
    if (c.money) rng.setNumberFormat('#,##0.00');
    if (c.auto) rng.setFontColor('#5f6368');
    if (c.rule) rng.setDataValidation(c.rule());
  });
}

function ensureHeaders_(sh, titles) {
  const lastCol = sh.getLastColumn();
  const header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  let next = header.length;
  while (next > 0 && !header[next - 1]) next--;
  titles.forEach(function (title) {
    if (header.indexOf(title) >= 0) return;
    if (next + 1 > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), next + 1 - sh.getMaxColumns());
    sh.getRange(1, next + 1).setValue(title);
    header[next] = title;
    next++;
  });
}

function prepareSettings_(ss) {
  const sh = ss.getSheetByName(AYAR_SAYFASI) || ss.insertSheet(AYAR_SAYFASI);
  if (!str_(sh.getRange(1, 1).getValue())) sh.getRange(1, 1, 1, 3).setValues([['Ayar', 'Değer', 'Açıklama']]);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8f0fe');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 420);
  AYARLAR.forEach(function (s) {
    let row = settingRow_(sh, s.title);
    const isNew = !row;
    if (isNew) {
      row = Math.max(sh.getLastRow(), 1) + 1;
      sh.getRange(row, 1).setValue(s.title);
    }
    sh.getRange(row, 3).setValue(s.help);
    const cell = sh.getRange(row, 2);
    if (s.kind === 'time') cell.setNumberFormat('@'); // "10:00" saat değerine dönüşmesin: önce biçim, sonra değer
    if (isNew) cell.setValue(s.def);
    if (s.kind === 'time') {
      cell.setDataValidation(listRule_(timeList_(), 'Saat (ör. 10:00). Listede yoksa yazabilirsiniz.', true));
    } else if (s.kind === 'yesno') {
      cell.setDataValidation(listRule_(['Evet', 'Hayır'], 'Evet veya Hayır'));
    } else if (s.kind === 'minutes') {
      cell.setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 120).setAllowInvalid(false).build());
    } else if (s.kind === 'checkbox') {
      cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      if (cell.getValue() !== true) cell.setValue(false);
    } else if (s.kind === 'readonly') {
      cell.setBackground('#f1f3f4').setFontColor('#5f6368').setWrap(true);
    }
    sh.getRange(row, 3).setWrap(true).setFontColor('#5f6368');
  });
}

function settingRow_(sh, title) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const titles = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < titles.length; i++) if (String(titles[i][0]).trim() === title) return i + 2;
  return 0;
}

function removeEmptyDefaultSheet_(ss) {
  const ours = ourSheetNames_();
  ss.getSheets().forEach(function (sh) {
    if (ours.indexOf(sh.getName()) >= 0) return;
    if (!/^(Sheet|Sayfa|Page|Feuille|Hoja|Tabelle)\s*\d+$/i.test(sh.getName())) return;
    if (sh.getLastRow() === 0 && sh.getLastColumn() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function readSettingsRaw_(ss) {
  const out = {};
  const sh = ss.getSheetByName(AYAR_SAYFASI);
  if (!sh || sh.getLastRow() < 2) return out;
  const byTitle = {};
  AYARLAR.forEach(function (s) { byTitle[s.title] = s.key; });
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (row) {
    const k = byTitle[String(row[0]).trim()];
    if (k && !(k in out)) out[k] = row[1];
  });
  return out;
}

function readSettings_(ss) {
  const raw = readSettingsRaw_(ss);
  const warnings = [];
  let saat = parseTime_(raw.saat);
  if (!saat) {
    if (!isEmpty_(raw.saat)) warnings.push('Bildirim saati anlaşılamadı ("' + str_(raw.saat) + '"), 10:00 kullanıldı');
    saat = { h: 10, m: 0 };
  }
  const yes = function (v, def) { return isEmpty_(v) ? def : trLower_(str_(v)) !== 'hayır' && trLower_(str_(v)) !== 'hayir'; };
  let testDakika = Number(raw.testDakika);
  if (!isFinite(testDakika) || testDakika < 1) testDakika = 5;
  return {
    saat: saat,
    tutarAciklama: yes(raw.tutarAciklama, true),
    siralama: yes(raw.siralama, true),
    testDakika: Math.min(120, Math.round(testDakika)),
    warnings: warnings,
  };
}

function setSetting_(ss, key, value) {
  const sh = ss.getSheetByName(AYAR_SAYFASI);
  if (!sh) return;
  const spec = AYARLAR.filter(function (s) { return s.key === key; })[0];
  const row = settingRow_(sh, spec.title);
  if (!row) return;
  const cell = sh.getRange(row, 2);
  if (!sameCell_(cell.getValue(), value)) cell.setValue(value);
}

function listRule_(values, help, allowInvalid) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(!!allowInvalid).setHelpText(help || '').build();
}

function dateRule_() {
  return SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('Tarih (gg.aa.yyyy), ör. 15.11.2026').build();
}

function numberList_(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(String(i));
  return out;
}

function timeList_() {
  const out = [];
  for (let h = 0; h < 24; h++) { out.push(pad2_(h) + ':00'); out.push(pad2_(h) + ':30'); }
  return out;
}

// ===========================================================================
// 6) Saf yardımcılar: tarih, sayı, metin (Google servisine dokunmaz; testlerde doğrudan sınanır)
// ===========================================================================

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function isEmpty_(v) { return v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }

function toBool_(v) { return v === true || (typeof v === 'string' && v.trim().toUpperCase() === 'TRUE'); }

function str_(v) {
  if (v === null || v === undefined) return '';
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, CELL_TZ, 'yyyy-MM-dd');
  return String(v).trim();
}

function trLower_(s) { return String(s).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase(); }

function nameKey_(s) { return trLower_(s).replace(/\s+/g, ' ').trim(); }

function foldTr_(s) {
  return trLower_(s).replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

function normTeyit_(v) { return nameKey_(str_(v)) === 'teyitli' ? TEYITLI : TAHMINI; }

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function ymd_(y, m, d) { return y + '-' + pad2_(m) + '-' + pad2_(d); }

function parseYmd_(s) { const p = s.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }

function daysInMonth_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function validYmd_(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= daysInMonth_(y, m))) return null;
  return ymd_(y, m, d);
}

/** Hücre değerinden 'yyyy-MM-dd'. Boşsa '', anlaşılmazsa null. */
function cellToYmd_(v) {
  if (isEmpty_(v)) return '';
  if (isDate_(v)) return isNaN(v.getTime()) ? null : Utilities.formatDate(v, CELL_TZ, 'yyyy-MM-dd');
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // E-Tablolar seri tarih aralığı (1954–2119)
    const dt = new Date(Math.round((v - 25569) * 86400000));
    return ymd_(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof v === 'boolean') return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validYmd_(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return validYmd_(+m[3], +m[2], +m[1]);
  return null;
}

/** 'yyyy-MM-dd' → hücreye yazılacak tarih (tablonun saat diliminde gece yarısı). */
function ymdToCell_(s) { return Utilities.parseDate(s, CELL_TZ, 'yyyy-MM-dd'); }

function isPeriod_(s) { return /^\d{4}-\d{2}$/.test(s); }

function mkPeriod_(y, m) { return m >= 1 && m <= 12 && y >= 2000 && y <= 2100 ? y + '-' + pad2_(m) : null; }

/** "Kasım 2026", "kasim 2026", "2026-11", "11.2026", "11/2026" → '2026-11'. Boşsa '', anlaşılmazsa null. */
function parsePeriod_(v) {
  if (isEmpty_(v)) return '';
  if (isDate_(v)) return isNaN(v.getTime()) ? null : Utilities.formatDate(v, CELL_TZ, 'yyyy-MM');
  if (typeof v !== 'string') return null;
  const s = foldTr_(v).replace(/\s+/g, ' ').trim();
  let m = /^(\d{4})[-./](\d{1,2})$/.exec(s);
  if (m) return mkPeriod_(+m[1], +m[2]);
  m = /^(\d{1,2})[-./](\d{4})$/.exec(s);
  if (m) return mkPeriod_(+m[2], +m[1]);
  m = /^([a-z]+) (\d{4})$/.exec(s);
  if (m) {
    const i = AYLAR.map(foldTr_).indexOf(m[1]);
    if (i >= 0) return mkPeriod_(+m[2], i + 1);
  }
  return null;
}

function periodKey_(v) { return parsePeriod_(v) || ''; }

function periodOf_(ymd) { return ymd.slice(0, 7); }

function periodLabel_(key) { return isPeriod_(key) ? AYLAR[+key.slice(5, 7) - 1] + ' ' + key.slice(0, 4) : ''; }

function nextPeriod_(key) {
  let y = +key.slice(0, 4), m = +key.slice(5, 7) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + pad2_(m);
}

/** Dönemin son ödeme günü; gün o ayda yoksa ayın son günü (31 → 30 Kasım, 28/29 Şubat). */
function dueForPeriod_(key, day) {
  const y = +key.slice(0, 4), m = +key.slice(5, 7);
  return ymd_(y, m, Math.min(day, daysInMonth_(y, m)));
}

/** Açık ekstre dönemi: son ödeme günü bugün ya da sonra olan ilk dönem. */
function targetPeriod_(today, day) {
  const key = periodOf_(today);
  return dueForPeriod_(key, day) >= today ? key : nextPeriod_(key);
}

/** İlk tarihin gün sayısına bağlı kalarak k ay ekler: 31 Ocak +1 → 28 Şubat, +2 → 31 Mart. */
function addMonthsAnchored_(s, k, anchorDay) {
  const p = parseYmd_(s);
  const t = p.y * 12 + (p.m - 1) + k;
  const y = Math.floor(t / 12), m = (t % 12) + 1;
  return ymd_(y, m, Math.min(anchorDay, daysInMonth_(y, m)));
}

function addDays_(s, n) {
  const p = parseYmd_(s);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return ymd_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Günün dakikasından yerel tarih-saat ('yyyy-MM-ddTHH:mm:ss'); gece yarısını geçerse ertesi gün. */
function localTime_(ymd, minutesOfDay) {
  const days = Math.floor(minutesOfDay / 1440);
  const rem = minutesOfDay - days * 1440;
  return addDays_(ymd, days) + 'T' + pad2_(Math.floor(rem / 60)) + ':' + pad2_(rem % 60) + ':00';
}

function localToMs_(local) { return Utilities.parseDate(local, TZ, "yyyy-MM-dd'T'HH:mm:ss").getTime(); }

function fmtYmd_(s) {
  if (!s) return '';
  const p = parseYmd_(s);
  return pad2_(p.d) + '.' + pad2_(p.m) + '.' + p.y;
}

function stamp_(d, fmt) { return Utilities.formatDate(d, TZ, fmt); }

function parseTime_(v) {
  if (isEmpty_(v)) return null;
  if (isDate_(v)) return parseTime_(Utilities.formatDate(v, CELL_TZ, 'HH:mm'));
  if (typeof v === 'number') {
    if (v >= 0 && v < 1) { const mins = Math.round(v * 1440); return { h: Math.floor(mins / 60), m: mins % 60 }; }
    if (Number.isInteger(v) && v >= 0 && v <= 23) return { h: v, m: 0 };
    return null;
  }
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(String(v).trim());
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  return h <= 23 && mi <= 59 ? { h: h, m: mi } : null;
}

function parseDay_(v) {
  if (isEmpty_(v)) return '';
  if (isDate_(v) || typeof v === 'boolean') return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

function parseCount_(v) {
  if (isEmpty_(v)) return '';
  if (isDate_(v) || typeof v === 'boolean') return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n >= 0 && n <= 600 ? n : null;
}

function round2_(n) { return Math.round(n * 100) / 100; }

/** Tutar: 12345.67, "12.345,67", "12345,67 TL" → 12345.67. Boşsa '', anlaşılmazsa null. */
function parseAmount_(v) {
  if (isEmpty_(v)) return '';
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? round2_(v) : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/\s/g, '').replace(/(TL|TRY|₺)$/i, '');
  if (!s) return '';
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return round2_(Number(s));
}

function sameAmount_(a, b) {
  if (a === '' && b === '') return true;
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005;
}

/** 12345.6, 'TRY' → '12.345,60 TL' */
function formatMoney_(n, pb) {
  const parts = Math.abs(n).toFixed(2).split('.');
  const whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + whole + ',' + parts[1] + ' ' + (pb === 'TRY' ? 'TL' : pb);
}

function uuidHex_(n) { return Utilities.getUuid().replace(/-/g, '').toLowerCase().slice(0, n); }

/** 64 bitlik hızlı özet (cyrb53 türevi); imzalar için. */
function hash_(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ('0000000' + (h2 >>> 0).toString(16)).slice(-8) + ('0000000' + (h1 >>> 0).toString(16)).slice(-8);
}
