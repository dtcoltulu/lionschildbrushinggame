// Kabul testleri: istenen senaryolar sahte Google servisleri üzerinde uçtan uca.
// Çalıştırma: odeme-takvimi klasöründe `npm test` (bağımlılık yok, Node 20+).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, day, formatDate } from './gas-mock.mjs';

const P = 'Ödemeler';
const K = 'Kartlar';
const C = 'Krediler';
const ymd = (d) => (d instanceof Date || Object.prototype.toString.call(d) === '[object Date]' ? formatDate(d, 'Europe/Istanbul', 'yyyy-MM-dd') : d);
const FULL = [{ method: 'popup', minutes: 2880 }, { method: 'popup', minutes: 0 }];

function setup(now = '2026-10-31T19:00:00+03:00') {
  const env = createEnv({ now });
  env.run('kurulum');
  return env;
}
const rows = (env) => env.table(P);
const rowsOf = (env, ad) => rows(env).filter((r) => r['Kart / kredi'] === ad);
const eventOf = (env, row) => env.events().find((e) => e.extendedProperties.private.odemeId === row['Kimlik']);
const addCard = (env, ad, gun) => env.addRow(K, gun === undefined ? { 'Kart (kısa ad)': ad } : { 'Kart (kısa ad)': ad, 'Olağan son ödeme günü': gun });
const addLoan = (env, ad, ilk, kalan, tutar, pb = 'TRY') => env.addRow(C, {
  'Kredi (kısa ad)': ad, 'Sıradaki taksit tarihi': day(ilk), 'Kalan taksit (bu dahil)': kalan, 'Aylık taksit tutarı': tutar, 'Para birimi': pb,
});

// ---------------------------------------------------------------------------
test('kurulum iki kez: tek takvim (Europe/Istanbul), tetikleyici başına tek kayıt, veri ve etkinlik korunur', () => {
  const env = createEnv();
  env.run('kurulum');
  addCard(env, 'Bonus', 15);
  const before = { events: env.events().length, rows: rows(env).length, id: env.calId() };
  env.run('kurulum');
  env.run('kurulum');

  assert.equal(env.calendar.calendars.size, 1, 'tek takvim');
  const cal = env.calendar.calendars.get(env.calId());
  assert.equal(cal.summary, 'Ödemelerim');
  assert.equal(cal.timeZone, 'Europe/Istanbul');
  assert.equal(env.calId(), before.id);
  assert.equal(env.setting('Takvim kimliği'), before.id, 'kimlik Ayarlar sekmesinde de saklı');
  assert.deepEqual(env.triggerCounts(), { duzenlemedeEsitle: 1, degisiklikteEsitle: 1, gunlukEsitle: 1 });
  const daily = env.scriptApp.triggers.find((t) => t.fn === 'gunlukEsitle');
  assert.equal(daily.atHour, 6);
  assert.equal(daily.tz, 'Europe/Istanbul');
  assert.equal(env.ss.getSpreadsheetTimeZone(), 'Europe/Istanbul');
  assert.deepEqual(env.ss.getSheets().map((s) => s.getName()), ['Kartlar', 'Krediler', 'Ödemeler', 'Ayarlar'], 'boş Sayfa1 kaldırıldı');
  assert.equal(env.events().length, before.events);
  assert.equal(rows(env).length, before.rows);
});

test('kurulum: tablo kopyalanıp kopyada kurulum çalışırsa kopya kendi takvimini açar (aynı takvim için çekişme yok)', () => {
  const env = setup();
  const first = env.calId();
  env.props.setProperty('takvimTablo', 'BASKA-TABLO'); // betik özellikleri başka bir tablodan kopyalanmış gibi
  env.run('kurulum');
  assert.notEqual(env.calId(), first);
  assert.equal(env.props.getProperty('takvimTablo'), 'TEST');
  assert.equal(env.setting('Takvim kimliği'), env.calId());
  assert.equal(env.setting('Bildirim saati'), '10:00');
  assert.equal(typeof env.setting('Bildirim saati'), 'string');
});

test('kurulum: telefonda hücre, açılır liste ve onay kutusu; teknik sütunlar gizli; hassas bilgi sorulmaz', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const s = env.sheet(P);
  const rule = (title, r = 2) => s.rules.get(`${r},${env.col(P, title)}`);
  assert.equal(rule('Ödendi').type, 'checkbox');
  assert.equal(rule('Ödendi', 900).type, 'checkbox', 'yeni satırlarda da onay kutusu');
  assert.deepEqual(rule('Tarih teyidi').list, ['Tahmini', 'Teyitli']);
  assert.deepEqual(rule('Para birimi').list, ['TRY', 'USD', 'EUR', 'GBP']);
  assert.equal(rule('Son ödeme (vade)').type, 'date');
  assert.deepEqual(rule('Kart / kredi').list, ['Bonus'], 'ad listesi Kartlar/Krediler’den');
  assert.deepEqual(env.sheet(K).rules.get(`2,${env.col(K, 'Aktif / Pasif')}`).list, ['Aktif', 'Pasif']);
  for (const t of ['Kimlik', 'Kaynak kimliği', 'Dönem anahtarı', 'Eşitleme imzası', 'Takvimdeki hal', 'Sistem vadesi']) {
    assert.ok(s.hidden.has(env.col(P, t)), t + ' gizli');
  }
  assert.equal(s.frozenRows, 1);
  const allHeaders = [K, C, P].flatMap((n) => env.header(n)).join(' | ');
  assert.doesNotMatch(allHeaders, /numara|iban|şifre|parola|cvv|giriş/i);
  // Ayarlar onay kutuları telefondan kullanılabilir
  const a = env.sheet('Ayarlar');
  const row = [...Array(a.getLastRow()).keys()].map((i) => i + 1).find((r) => a.get(r, 1) === 'Test bildirimi oluştur');
  assert.equal(a.rules.get(`${row},2`).type, 'checkbox');
  assert.equal(a.get(row, 2), false);
});

// ---------------------------------------------------------------------------
test('kart: olağan gün 15 → dönem başına tek tahmini kayıt, "Ekstreyi kontrol et", 10:00, varsayılan hatırlatma kapalı, 2880+0 popup', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const r = rows(env);
  assert.equal(r.length, 1);
  assert.equal(r[0]['Kart / kredi'], 'Bonus');
  assert.equal(r[0]['Dönem / taksit'], 'Kasım 2026');
  assert.equal(ymd(r[0]['Son ödeme (vade)']), '2026-11-15');
  assert.equal(r[0]['Tutar'], '', 'tutar bilinmiyor: boş');
  assert.equal(r[0]['Tarih teyidi'], 'Tahmini');
  assert.equal(r[0]['Ödendi'], false);
  assert.equal(r[0]['Tür'], 'Kart');
  assert.match(r[0]['Takvim durumu'], /^Takvimde ✓/);
  assert.equal(typeof r[0]['Dönem anahtarı'], 'string', 'dönem anahtarı tarihe dönüşmedi');
  assert.equal(r[0]['Dönem anahtarı'], '2026-11');

  const evs = env.events();
  assert.equal(evs.length, 1);
  const ev = evs[0];
  assert.equal(ev.summary, 'Ekstreyi kontrol et · Bonus');
  assert.deepEqual(ev.start, { dateTime: '2026-11-15T10:00:00', timeZone: 'Europe/Istanbul' });
  assert.deepEqual(ev.end, { dateTime: '2026-11-15T10:30:00', timeZone: 'Europe/Istanbul' });
  assert.equal(ev.reminders.useDefault, false);
  assert.deepEqual(ev.reminders.overrides, FULL);
  assert.match(ev.id, /^[0-9a-v]{5,1024}$/, 'Google etkinlik kimliği kuralı (base32hex)');
  assert.match(env.table(K)[0]['Bilgi (otomatik)'], /15\.11\.2026/);
});

test('senaryo: kart vadesi 15’ten 16’ya taşınır (olağan gün değişir) → aynı etkinlik güncellenir, ikinci etkinlik yok', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const id = env.events()[0].id;
  const inserts = env.calendar.calls.filter((c) => c.op === 'events.insert').length;
  env.edit(K, 2, 'Olağan son ödeme günü', 16);

  const r = rows(env);
  assert.equal(r.length, 1);
  assert.equal(ymd(r[0]['Son ödeme (vade)']), '2026-11-16');
  const evs = env.events();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].id, id);
  assert.equal(evs[0].start.dateTime, '2026-11-16T10:00:00');
  assert.deepEqual(evs[0].reminders.overrides, FULL, 'tarih değişince iki hatırlatma yeniden kurulur');
  assert.equal(env.calendar.calls.filter((c) => c.op === 'events.insert').length, inserts, 'yeni etkinlik eklenmedi');
});

test('senaryo: ekstre teyidi — gerçek tarih 16 ve tutar girilir, "Teyitli" → "Kart ödemesi", tutar başlıkta yok, aynı etkinlik', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const id = env.events()[0].id;
  const row = rows(env)[0]._row;
  env.edit(P, row, 'Son ödeme (vade)', day('2026-11-16'));
  assert.equal(env.events()[0].summary, 'Ekstreyi kontrol et · Bonus', 'teyit edilmeden başlık değişmez');
  env.edit(P, row, 'Tutar', 12345.67);
  env.edit(P, row, 'Tarih teyidi', 'Teyitli');

  const evs = env.events();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].id, id);
  assert.equal(evs[0].summary, 'Kart ödemesi · Bonus');
  assert.doesNotMatch(evs[0].summary, /\d/, 'başlıkta tutar yok');
  assert.match(evs[0].description, /12\.345,67 TL/, 'tutar yalnızca açıklamada');
  assert.equal(evs[0].start.dateTime, '2026-11-16T10:00:00');
  assert.deepEqual(evs[0].reminders.overrides, FULL);

  // Teyitli tarih, olağan gün sonradan değişse bile korunur.
  env.edit(K, 2, 'Olağan son ödeme günü', 20);
  assert.equal(ymd(rows(env)[0]['Son ödeme (vade)']), '2026-11-16');
  assert.equal(env.events().length, 1);
});

test('kart: teyitli tarih sonraki aya taşınsa da aynı dönem için ikinci etkinlik yok; yeni dönem ayrı açılır', () => {
  const env = setup();
  addCard(env, 'Bonus', 30);
  const row = rows(env)[0]._row;
  assert.equal(ymd(rows(env)[0]['Son ödeme (vade)']), '2026-11-30');
  env.edit(P, row, 'Son ödeme (vade)', day('2026-12-02'));
  env.edit(P, row, 'Tarih teyidi', 'Teyitli');
  assert.equal(env.events().length, 1);
  assert.equal(rows(env)[0]['Dönem / taksit'], 'Kasım 2026', 'dönem tarihe göre değişmez');

  for (const d of ['2026-12-01', '2026-12-02', '2026-12-03']) { env.setNow(d + 'T06:10:00+03:00'); env.daily(); env.daily(); }
  const r = rows(env);
  assert.deepEqual(r.map((x) => x['Dönem / taksit']).sort(), ['Aralık 2026', 'Kasım 2026']);
  assert.equal(env.events().length, 2);
  const kasim = r.find((x) => x['Dönem / taksit'] === 'Kasım 2026');
  assert.equal(eventOf(env, kasim).start.dateTime, '2026-12-02T10:00:00');
  assert.equal(eventOf(env, kasim).summary, 'Kart ödemesi · Bonus');
});

test('kart: dönemler kullanıcı tabloyu açmadan günlük eşitlemeyle ilerler; her dönem için en fazla bir kayıt; 31 → ay sonu', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  addCard(env, 'Ay sonu', 31);
  const start = Date.parse('2026-11-01T06:10:00+03:00');
  for (let i = 0; i <= 112; i++) { env.setNow(new Date(start + i * 86400000).toISOString()); env.daily(); }
  // 21 Şubat 2027: Bonus için Mart dönemi açık, Ay sonu için Şubat (28) dönemi açık.
  const bonus = rowsOf(env, 'Bonus').map((r) => r['Dönem anahtarı']).sort();
  assert.deepEqual(bonus, ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  // "Ay sonu" 31 Ekim'de (vade günü) eklendi: Ekim dönemi o gün hâlâ açıktı.
  const aySonu = rowsOf(env, 'Ay sonu').map((r) => ymd(r['Son ödeme (vade)'])).sort();
  assert.deepEqual(aySonu, ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  assert.equal(env.events().length, bonus.length + aySonu.length);
  const ids = env.events().map((e) => e.extendedProperties.private.odemeId);
  assert.equal(new Set(ids).size, ids.length, 'mükerrer etkinlik yok');
});

test('kart: olağan gün yoksa ekstre elle eklenir; aynı döneme ikinci satır hata verir ve etkinlik açmaz', () => {
  const env = setup();
  addCard(env, 'Axess');
  assert.match(env.table(K)[0]['Bilgi (otomatik)'], /Olağan gün yok/);
  assert.equal(rows(env).length, 0, 'olağan gün yoksa otomatik kayıt yok');

  const r1 = env.firstEmptyRow(P);
  env.edit(P, r1, 'Kart / kredi', 'Axess');
  assert.match(rows(env)[0]['Takvim durumu'], /^Eksik: son ödeme tarihini/);
  assert.equal(env.events().length, 0, 'eksik satır için etkinlik yok');
  env.edit(P, r1, 'Son ödeme (vade)', day('2026-11-20'));
  env.edit(P, r1, 'Tarih teyidi', 'Teyitli');
  let r = rows(env);
  assert.equal(r[0]['Dönem / taksit'], 'Kasım 2026', 'dönem vadenin ayından');
  assert.equal(env.events().length, 1);
  assert.equal(env.events()[0].summary, 'Kart ödemesi · Axess');

  const r2 = env.addRow(P, { 'Kart / kredi': 'Axess', 'Son ödeme (vade)': day('2026-11-25') });
  r = rows(env);
  const dup = r.find((x) => x._row === r2);
  assert.match(dup['Takvim durumu'], /^HATA: Kasım 2026 ekstresi için \d+\. satırda zaten kayıt var/);
  assert.equal(env.events().length, 1, 'ikinci etkinlik yok');

  env.edit(P, r2, 'Dönem / taksit', 'Aralık 2026');
  assert.match(rows(env).find((x) => x._row === r2)['Takvim durumu'], /^Takvimde ✓/);
  assert.equal(env.events().length, 2);
});

test('kart: ekstre önce elle eklendiyse olağan gün sonradan girilince aynı dönem için ikinci kayıt açılmaz', () => {
  const env = setup();
  addCard(env, 'Bonus');
  env.addRow(P, { 'Kart / kredi': 'Bonus', 'Son ödeme (vade)': day('2026-11-14'), 'Tarih teyidi': 'Teyitli' });
  env.edit(K, 2, 'Olağan son ödeme günü', 15);
  const r = rowsOf(env, 'Bonus');
  assert.equal(r.length, 1);
  assert.equal(ymd(r[0]['Son ödeme (vade)']), '2026-11-14', 'elle girilen tarih korunur');
  assert.equal(env.events().length, 1);
  assert.equal(env.events()[0].summary, 'Kart ödemesi · Bonus');
});

test('kart: kopyala-yapıştır ile çoğaltılan satır yeni kimlik alır, aynı dönem için ikinci etkinlik açılmaz', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const s = env.sheet(P);
  const w = s.getLastColumn();
  const src = s.getRange(2, 1, 1, w).getValues();
  s.getRange(3, 1, 1, w).setValues(src);
  env.fire('ON_EDIT', { range: s.getRange(3, 1, 1, w) });
  const r = rows(env);
  assert.equal(r.length, 2);
  assert.notEqual(r[0]['Kimlik'], r[1]['Kimlik']);
  assert.match(r[1]['Takvim durumu'], /^HATA: Kasım 2026 ekstresi/);
  assert.equal(env.events().length, 1);
});

test('kart: pasif kart için yeni dönem açılmaz, mevcut kayıt korunur', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  env.edit(K, 2, 'Aktif / Pasif', 'Pasif');
  env.setNow('2026-12-20T06:10:00+03:00');
  env.daily();
  assert.equal(rows(env).length, 1);
  assert.equal(env.events().length, 1);
  assert.match(env.table(K)[0]['Bilgi (otomatik)'], /^Pasif/);
});

// ---------------------------------------------------------------------------
test('senaryo: kalan 6 taksit → tam 6 ayrı kayıt ve 6 etkinlik; ay sonu 31 Ocak → 28 Şubat → 31 Mart …', () => {
  const env = setup();
  addLoan(env, 'Taşıt', '2027-01-31', 6, 4250);
  const r = rowsOf(env, 'Taşıt');
  assert.equal(r.length, 6, 'tam 6 kayıt');
  assert.deepEqual(r.map((x) => ymd(x['Son ödeme (vade)'])), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  assert.deepEqual(r.map((x) => x['Dönem / taksit']), ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
  assert.ok(r.every((x) => typeof x['Dönem / taksit'] === 'string'), '"3/6" tarihe dönüşmedi');
  assert.ok(r.every((x) => x['Tutar'] === 4250 && x['Para birimi'] === 'TRY' && x['Tür'] === 'Kredi'));
  const evs = env.events();
  assert.equal(evs.length, 6);
  assert.ok(evs.every((e) => e.summary === 'Kredi taksiti · Taşıt'));
  assert.deepEqual(evs.map((e) => e.start.dateTime).sort(), r.map((x) => ymd(x['Son ödeme (vade)']) + 'T10:00:00'));
  assert.ok(evs.every((e) => JSON.stringify(e.reminders) === JSON.stringify({ useDefault: false, overrides: FULL })));
  assert.match(env.table(C)[0]['Bilgi (otomatik)'], /^6 taksit planlandı · ilk 31\.01\.2027 · son 30\.06\.2027/);

  // Artık yılda 29 Şubat; 30'unda başlayan kredi Şubat'ta 28'e iner, sonra 30'a döner.
  addLoan(env, 'Konut', '2028-01-31', 2, 10000);
  assert.deepEqual(rowsOf(env, 'Konut').map((x) => ymd(x['Son ödeme (vade)'])), ['2028-01-31', '2028-02-29']);
  addLoan(env, 'İhtiyaç', '2026-12-30', 4, 900);
  assert.deepEqual(rowsOf(env, 'İhtiyaç').map((x) => ymd(x['Son ödeme (vade)'])), ['2026-12-30', '2027-01-30', '2027-02-28', '2027-03-30']);
});

test('kredi: banka planına göre tek taksidin tarih/tutar düzeltmesi sonraki eşitlemeleri ve plan değişikliğini atlatır', () => {
  const env = setup();
  addLoan(env, 'Konut', '2026-11-05', 6, 1000);
  const third = rowsOf(env, 'Konut').find((x) => x['Dönem / taksit'] === '3/6');
  env.edit(P, third._row, 'Son ödeme (vade)', day('2027-01-07'));
  env.edit(P, third._row, 'Tutar', 1100);
  env.run('simdiEsitle');
  env.daily();
  env.edit(C, 2, 'Aylık taksit tutarı', 1200);
  env.edit(C, 2, 'Sıradaki taksit tarihi', day('2026-11-06'));

  const r = rowsOf(env, 'Konut');
  assert.equal(r.length, 6);
  const t3 = r.find((x) => x['Dönem / taksit'] === '3/6');
  assert.equal(ymd(t3['Son ödeme (vade)']), '2027-01-07', 'elle düzeltilen tarih korunur');
  assert.equal(t3['Tutar'], 1100, 'elle düzeltilen tutar korunur');
  for (const x of r.filter((y) => y !== t3)) {
    assert.equal(x['Tutar'], 1200);
    assert.equal(ymd(x['Son ödeme (vade)']).slice(8), '06');
  }
  assert.equal(eventOf(env, t3).start.dateTime, '2027-01-07T10:00:00');
  assert.equal(env.events().length, 6);
});

test('kredi: kalan sayısı değişince kayıt sayısı tam eşleşir (6 → 8 → yeniden başlat 5 → 0); ödenen taksit geçmişte kalır', () => {
  const env = setup();
  addLoan(env, 'Taşıt', '2026-11-05', 6, 2000);
  const first = rowsOf(env, 'Taşıt')[0];
  env.edit(P, first._row, 'Ödendi', true);
  env.edit(C, 2, 'Kalan taksit (bu dahil)', 8);
  assert.equal(rowsOf(env, 'Taşıt').length, 8);
  assert.equal(env.events().length, 8);

  // Bir taksit ödendikten sonra kullanıcı krediyi güncel haliyle yeniden girer: sıradaki 5 Aralık, kalan 5.
  env.edit(C, 2, 'Sıradaki taksit tarihi', day('2026-12-05'));
  env.edit(C, 2, 'Kalan taksit (bu dahil)', 5);
  let r = rowsOf(env, 'Taşıt');
  const open = r.filter((x) => !x['Ödendi']);
  assert.equal(open.length, 5, 'tam 5 açık taksit');
  assert.deepEqual(open.map((x) => ymd(x['Son ödeme (vade)'])), ['2026-12-05', '2027-01-05', '2027-02-05', '2027-03-05', '2027-04-05']);
  assert.equal(r.filter((x) => x['Ödendi']).length, 1, 'ödenen taksit geçmişte');
  assert.equal(env.events().length, 6);

  env.edit(C, 2, 'Kalan taksit (bu dahil)', 0);
  r = rowsOf(env, 'Taşıt');
  assert.equal(r.length, 1, 'yalnızca ödenmiş geçmiş kalır');
  assert.equal(env.events().length, 1);
  assert.match(env.table(C)[0]['Bilgi (otomatik)'], /^Kalan taksit 0/);
});

// ---------------------------------------------------------------------------
test('senaryo: Ödendi işaretlenir → kalan bildirimler kalkar, satır geçmişte kalır; geri alınır → gelecekteki hatırlatmalar geri gelir', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const row = rows(env)[0]._row;
  const id = env.events()[0].id;

  env.edit(P, row, 'Ödendi', true);
  let r = rows(env)[0];
  let ev = env.events()[0];
  assert.equal(ev.id, id);
  assert.deepEqual(ev.reminders, { useDefault: false, overrides: [] });
  assert.equal(ev.summary, '✓ Ekstreyi kontrol et · Bonus');
  assert.equal(ymd(r['Ödendiği gün']), '2026-10-31');
  assert.match(r['Takvim durumu'], /^Ödendi ✓ · bildirimler kapalı/);
  env.daily();
  assert.equal(rows(env).length, 1, 'ödenen satır silinmez');
  assert.deepEqual(env.events()[0].reminders.overrides, []);

  env.edit(P, row, 'Ödendi', false);
  r = rows(env)[0];
  ev = env.events()[0];
  assert.equal(ev.id, id);
  assert.deepEqual(ev.reminders, { useDefault: false, overrides: FULL });
  assert.equal(ev.summary, 'Ekstreyi kontrol et · Bonus');
  assert.equal(r['Ödendiği gün'], '');
  assert.equal(env.events().length, 1);

  // Vadeye 2 günden az kala geri alınırsa yalnızca zamanı gelmemiş hatırlatma (0 dk) geri gelir.
  env.setNow('2026-11-14T12:00:00+03:00');
  env.edit(P, row, 'Ödendi', true);
  env.edit(P, row, 'Ödendi', false);
  assert.deepEqual(env.events()[0].reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
});

test('PATCH boş hatırlatma listesini yok sayarsa etkinlik tam haliyle yeniden yazılır (bildirimler yine kalkar)', () => {
  const env = setup();
  env.calendar.ignoreEmptyOverridesOnPatch = true;
  addCard(env, 'Bonus', 15);
  const row = rows(env)[0]._row;
  env.edit(P, row, 'Ödendi', true);
  const ev = env.events()[0];
  assert.deepEqual(ev.reminders, { useDefault: false, overrides: [] });
  assert.equal(ev.summary, '✓ Ekstreyi kontrol et · Bonus');
  assert.ok(env.calendar.calls.some((c) => c.op === 'events.update'));
  assert.equal(env.events().length, 1);
});

test('senaryo: aynı veri iki kez eşitlenir → takvime hiç yazılmaz; etkinlik, satır ve tetikleyici sayısı değişmez', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  addLoan(env, 'Taşıt', '2027-01-31', 6, 4250);
  env.run('simdiEsitle');
  const snapshot = () => ({ events: env.events().length, rows: rows(env).length, triggers: env.triggerCounts(), cals: env.calendar.calendars.size });
  const before = snapshot();
  const writes = env.calendar.writes();

  env.run('simdiEsitle');
  env.run('simdiEsitle');
  env.daily();
  env.edit(K, 2, 'Olağan son ödeme günü', 15); // aynı değer
  env.run('kurulum');

  assert.equal(env.calendar.writes(), writes, 'ikinci ve sonraki eşitlemeler takvime yazmaz');
  assert.deepEqual(snapshot(), before);
  assert.equal(before.events, 7);
  const ids = env.events().map((e) => e.extendedProperties.private.odemeId);
  assert.equal(new Set(ids).size, ids.length);
});

test('başarısız eşitleme ilgili satırda görünür, imza yazılmaz; sonraki eşitleme kendiliğinden düzeltir; geçici hata yeniden denenir', () => {
  const env = setup();
  const err = new Error('API call to calendar.events.insert failed with error: Invalid value for: Invalid reminder');
  err.details = { code: 400 };
  env.calendar.failNext('events.insert', 1, err);
  addCard(env, 'Bonus', 15);
  let r = rows(env)[0];
  assert.match(r['Takvim durumu'], /^HATA: Invalid value for: Invalid reminder · .* · otomatik tekrar denenecek$/);
  assert.equal(r['Eşitleme imzası'], '');
  assert.equal(env.events().length, 0);
  assert.match(env.setting('Son eşitleme'), /1 hata/);

  env.daily();
  r = rows(env)[0];
  assert.match(r['Takvim durumu'], /^Takvimde ✓/);
  assert.equal(env.events().length, 1);

  env.calendar.failNext('events.patch', 2); // 500 Backend Error ×2 → aynı çalıştırmada yeniden denenir
  env.edit(K, 2, 'Olağan son ödeme günü', 16);
  assert.match(rows(env)[0]['Takvim durumu'], /^Takvimde ✓/);
  assert.equal(env.events()[0].start.dateTime, '2026-11-16T10:00:00');
});

test('satır silinince etkinliği kaldırılır ve yeniden üretilmez; takvimden silinen açık etkinlik günlük eşitlemede geri gelir', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  addLoan(env, 'Taşıt', '2027-01-31', 3, 100);
  assert.equal(env.events().length, 4);
  const second = rowsOf(env, 'Taşıt')[1];
  env.deleteRow(P, second._row);
  assert.equal(env.events().length, 3);
  assert.equal(rowsOf(env, 'Taşıt').length, 2, 'kullanıcının sildiği taksit geri getirilmez');

  const card = rowsOf(env, 'Bonus')[0];
  const evId = eventOf(env, card).id;
  env.calendar.Events.remove(env.calId(), evId); // kullanıcı etkinliği takvimden siler
  env.edit(K, 2, 'Olağan son ödeme günü', 15);
  assert.equal(env.events().length, 2, 'hızlı eşitleme imza aynıysa takvime sormaz');
  env.daily();
  assert.equal(env.events().length, 3);
  assert.equal(eventOf(env, rowsOf(env, 'Bonus')[0]).id, evId, 'aynı kimlikle geri geldi');
});

test('bildirim saati Ayarlar’dan değişir; anlaşılmayan saat 10:00’a döner ve uyarı verir', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  env.setting('Bildirim saati', '09:30');
  let ev = env.events()[0];
  assert.equal(ev.start.dateTime, '2026-11-15T09:30:00');
  assert.equal(ev.end.dateTime, '2026-11-15T10:00:00');
  assert.deepEqual(ev.reminders.overrides, FULL);
  env.setting('Bildirim saati', 'öğlen');
  ev = env.events()[0];
  assert.equal(ev.start.dateTime, '2026-11-15T10:00:00');
  assert.match(env.setting('Son eşitleme'), /Bildirim saati anlaşılamadı/);
  assert.equal(env.events().length, 1);
});

test('kart adı değişince ödemeler, etkinlik başlığı ve açılır liste güncellenir', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const id = env.events()[0].id;
  env.edit(K, 2, 'Kart (kısa ad)', 'Bonus Platinum');
  assert.equal(rows(env)[0]['Kart / kredi'], 'Bonus Platinum');
  assert.equal(env.events()[0].id, id);
  assert.equal(env.events()[0].summary, 'Ekstreyi kontrol et · Bonus Platinum');
  assert.deepEqual(env.sheet(P).rules.get(`2,${env.col(P, 'Kart / kredi')}`).list, ['Bonus Platinum']);
});

// ---------------------------------------------------------------------------
test('test bildirimi: birkaç dakika sonrası, tek popup (0 dk), silinebilir; Ayarlar onay kutusuyla telefondan da çalışır', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  env.setNow('2026-10-31T19:00:20+03:00');
  const res = env.run('testBildirimiOlustur');
  let tests = env.events('test');
  assert.equal(tests.length, 1);
  const startMs = Date.parse(tests[0].start.dateTime + '+03:00');
  assert.ok(startMs >= env.now().getTime() + 5 * 60000 && startMs <= env.now().getTime() + 6 * 60000, 'yaklaşık 5 dk sonra');
  assert.deepEqual(tests[0].reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
  assert.equal(tests[0].summary, 'Test bildirimi · Ödeme Takvimi');
  assert.match(res.mesaj, /31\.10\.2026 19:06/);

  env.setting('Test bildirimi kaç dakika sonra', 2);
  env.setting('Test bildirimi oluştur', true);
  assert.equal(env.setting('Test bildirimi oluştur'), false, 'kutu kendiliğinden boşalır');
  assert.match(env.setting('Test sonucu'), /2 dk sonra/);
  assert.equal(env.events('test').length, 2);

  env.setting('Test etkinliklerini sil', true);
  assert.equal(env.events('test').length, 0);
  assert.equal(env.events().length, 1, 'ödeme etkinliğine dokunulmadı');

  env.run('testBildirimiOlustur', 3);
  env.setNow('2026-11-02T06:10:00+03:00');
  env.daily();
  assert.equal(env.events('test').length, 0, 'bir günden eski test etkinliği her sabah silinir');
});

test('zaman bütçesi aşılırsa kalan satırlar "Bekliyor" olur, tek bir devam tetikleyicisi kurulur ve iş tamamlanır', () => {
  const env = setup();
  env.ctx.ZAMAN_BUTCESI_MS = -1;
  addLoan(env, 'Taşıt', '2027-01-31', 6, 100);
  assert.equal(env.events().length, 0);
  assert.ok(rowsOf(env, 'Taşıt').every((x) => /^Bekliyor/.test(x['Takvim durumu'])));
  assert.equal(env.triggerCounts().devamEsitle, 1);
  env.edit(C, 2, 'Para birimi', 'TRY');
  assert.equal(env.triggerCounts().devamEsitle, 1, 'devam tetikleyicisi çoğalmaz');

  env.ctx.ZAMAN_BUTCESI_MS = 270000;
  env.run('devamEsitle');
  assert.equal(env.events().length, 6);
  assert.ok(rowsOf(env, 'Taşıt').every((x) => /^Takvimde ✓/.test(x['Takvim durumu'])));
  assert.equal(env.triggerCounts().devamEsitle, undefined);
});

test('günlük sıralama: ödenmemişler vadeye göre üstte, ödenenler altta', () => {
  const env = setup();
  addLoan(env, 'Taşıt', '2026-11-01', 3, 100);
  addCard(env, 'Bonus', 15);
  const first = rowsOf(env, 'Taşıt').find((x) => ymd(x['Son ödeme (vade)']) === '2026-11-01');
  env.edit(P, first._row, 'Ödendi', true);
  env.daily();
  const order = rows(env).map((x) => `${x['Kart / kredi']} ${ymd(x['Son ödeme (vade)'])}${x['Ödendi'] ? ' ✓' : ''}`);
  assert.deepEqual(order, ['Bonus 2026-11-15', 'Taşıt 2026-12-01', 'Taşıt 2027-01-01', 'Taşıt 2026-11-01 ✓']);
  const writes = env.calendar.writes();
  env.daily();
  assert.equal(env.calendar.writes(), writes, 'sıralama sonrası eşitleme yine yazmaz');
});

test('ilgisiz sekmedeki düzenleme eşitleme başlatmaz', () => {
  const env = setup();
  const s = env.ss.insertSheet('Notlarım');
  const calls = env.calendar.calls.length;
  env.fire('ON_EDIT', { range: s.getRange(1, 1) });
  assert.equal(env.calendar.calls.length, calls);
});

test('tetikleyici olmadan da güvenli: kurulum yapılmamışsa açık bir hata verir', () => {
  const env = createEnv();
  assert.throws(() => env.run('simdiEsitle'), /sekmesi bulunamadı/);
  delete env.ctx.Calendar;
  assert.throws(() => env.run('kurulum'), /Gelişmiş Google Takvim hizmeti açık değil/);
});

test('saglikKontrolu gerçek hesaptaki kabul denetimini yapar ve Ayarlar’a yazar', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  addLoan(env, 'Taşıt', '2027-01-31', 6, 100);
  env.edit(P, rowsOf(env, 'Taşıt')[0]._row, 'Ödendi', true);
  const out = env.run('saglikKontrolu');
  assert.doesNotMatch(out, /✗/);
  assert.match(env.setting('Sağlık kontrolü'), /sorun yok/);

  env.scriptApp.newTrigger('gunlukEsitle').timeBased().everyDays(1).create(); // elle fazladan tetikleyici
  const ev = env.events().find((e) => !e.summary.startsWith('✓'));
  env.calendar.Events.patch({ reminders: { useDefault: true } }, env.calId(), ev.id);
  const out2 = env.run('saglikKontrolu');
  assert.match(out2, /✗ Tetikleyici gunlukEsitle: 2 adet/);
  assert.match(out2, /✗ Hatırlatma kuralına uymayan etkinlik .*: 1/);
  env.run('kurulum');
  assert.equal(env.triggerCounts().gunlukEsitle, 1, 'kurulum fazla tetikleyiciyi temizler');
});

test('satırın içeriği silinirse (satır kalsa da) etkinlik kaldırılır, teknik hücreler temizlenir, kayıt yeniden açılmaz', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  const row = rows(env)[0]._row;
  for (const t of ['Kart / kredi', 'Dönem / taksit', 'Son ödeme (vade)', 'Tutar']) env.edit(P, row, t, '');
  assert.equal(env.events().length, 0);
  assert.equal(rows(env).length, 0, 'satır tamamen boşaldı');
  env.daily();
  assert.equal(rows(env).length, 0, 'aynı dönem için yeniden kayıt açılmadı');
});

test('toplu silmede güvenlik: Ödemeler bir anda boşalırsa takvimdeki etkinlikler silinmez, uyarı yazılır', () => {
  const env = setup();
  addLoan(env, 'Taşıt', '2027-01-31', 5, 100);
  const s = env.sheet(P);
  for (let i = 0; i < 5; i++) s.deleteRow(2);
  env.fire('ON_CHANGE', { changeType: 'REMOVE_ROW' });
  assert.equal(env.events().length, 5);
  assert.match(env.setting('Son eşitleme'), /güvenlik amacıyla silinmedi/);
});

test('kaldir: yalnızca bu uygulamanın tetikleyicilerini siler; tablo ve takvim kalır; kurulum geri kurar', () => {
  const env = setup();
  addCard(env, 'Bonus', 15);
  env.scriptApp.newTrigger('baskaBirIs').timeBased().everyDays(1).create();
  env.run('kaldir');
  assert.deepEqual(env.triggerCounts(), { baskaBirIs: 1 });
  assert.equal(env.events().length, 1);
  env.run('kurulum');
  assert.deepEqual(env.triggerCounts(), { baskaBirIs: 1, duzenlemedeEsitle: 1, degisiklikteEsitle: 1, gunlukEsitle: 1 });
  assert.equal(env.events().length, 1);
});
