// Mutasyon denetimi: Kod.gs'ye bilerek hata sokar ve testlerin her birini yakaladığını doğrular.
// Testler bir hatayı yakalayamıyorsa o kural aslında sınanmıyor demektir.
// Çalıştırma: odeme-takvimi klasöründe `npm run mutasyon`
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KOD_PATH } from './gas-mock.mjs';

const MUTASYONLAR = {
  'iki yerine tek hatırlatma': ['var HATIRLATMA_DK = [2880, 0];', 'var HATIRLATMA_DK = [2880];'],
  'varsayılan hatırlatmalar açık': ['function remindersFull_() {\n  return { useDefault: false,', 'function remindersFull_() {\n  return { useDefault: true,'],
  'aynı döneme ikinci kayıt': ['      if (!exists) {\n        const due', '      if (true) {\n        const due'],
  'imza yok sayılır (her eşitlemede yazar)': ["  if (imza === d.sig) return 'skip';\n  if (d.paid && !synced)", '  if (d.paid && !synced)'],
  '409 çakışması yakalanmaz': [
    'function isConflict_(e) { return errCode_(e) === 409 || /already exists|duplicate/i.test(String(e && e.message)); }',
    'function isConflict_(e) { return false; }',
  ],
  'bir taksit fazla': ['for (let i = 0; i < src.kalan; i++)', 'for (let i = 0; i <= src.kalan; i++)'],
  'elle düzeltilen taksit ezilir': ["if (cellToYmd_(p.val.vade) === cellToYmd_(p.val.sistemVade)) set_(p, 'vade'", "if (true) set_(p, 'vade'"],
  'geri almada geçmiş hatırlatma da gelir': ["  if (prev.state === 'odendi') {\n    const startMs", "  if (prev.state === 'odendi') { return remindersFull_();\n    const startMs"],
  'teyit başlıkları ters': [
    "(teyitli ? 'Kart ödemesi · ' + ad : 'Ekstreyi kontrol et · ' + ad)",
    "(teyitli ? 'Ekstreyi kontrol et · ' + ad : 'Kart ödemesi · ' + ad)",
  ],
  'ay sonu kuralı yok': ['  return ymd_(y, m, Math.min(anchorDay, daysInMonth_(y, m)));\n}', '  return ymd_(y, m, Math.min(28, daysInMonth_(y, m)));\n}'],
  'bildirim saati ayardan okunmaz': ['const startMin = ctx.settings.saat.h * 60 + ctx.settings.saat.m;', 'const startMin = 600;'],
  'ödendi bildirimleri kaldırmaz': ["  if (d.paid) return prev.state === 'odendi' ? null : remindersNone_();", '  if (d.paid) return null;'],
  'saat hücresi biçimden önce yazılır': [
    "    if (s.kind === 'time') cell.setNumberFormat('@'); // \"10:00\" saat değerine dönüşmesin: önce biçim, sonra değer\n    if (isNew) cell.setValue(s.def);",
    "    if (isNew) cell.setValue(s.def);\n    if (s.kind === 'time') cell.setNumberFormat('@');",
  ],
  'tetikleyici her kurulumda çoğalır': ['    if (!keep) w.make();', '    w.make();'],
  'takvim her seferinde yeniden açılır': ['  const id = storedCalendarId_(ss);\n  if (id) {', "  const id = '';\n  if (id) {"],
  'başarısız yazımda imza kaydedilir': ["      ctx.stats.hata++;\n      set_(r, 'takvim', 'HATA: '", "      ctx.stats.hata++; set_(r, 'imza', d.sig);\n      set_(r, 'takvim', 'HATA: '"],
  'silinen satırın etkinliği kalır': ['  orphans.forEach(function (id) {\n    if (outOfTime_(ctx))', '  [].forEach(function (id) {\n    if (outOfTime_(ctx))'],
  'kopyalanan satır aynı kimliği taşır': ['    if (!id || used[id]) {\n      const copied = !!id;', '    if (!id) {\n      const copied = !!id;'],
};

const src = fs.readFileSync(KOD_PATH, 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odeme-mutasyon-'));
const testDir = path.dirname(new URL(import.meta.url).pathname);
const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(testDir, f));
let kacan = 0;
for (const [ad, [eski, yeni]] of Object.entries(MUTASYONLAR)) {
  const n = src.split(eski).length - 1;
  if (n !== 1) { console.log(`?  ${ad}: kaynak metin ${n} kez bulundu (mutasyon güncellenmeli)`); kacan++; continue; }
  const file = path.join(dir, ad.replace(/[^a-z0-9]+/gi, '-') + '.gs');
  fs.writeFileSync(file, src.replace(eski, yeni));
  const r = spawnSync(process.execPath, ['--test', ...files], { env: { ...process.env, KOD_GS: file }, encoding: 'utf8' });
  const fail = Number((/# fail (\d+)/.exec(r.stdout) || [])[1] || 0);
  console.log(`${fail > 0 ? '✓' : '✗'}  ${ad}: ${fail} test yakaladı`);
  if (!fail) kacan++;
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(kacan ? `\n${kacan} mutasyon yakalanmadı.` : `\n${Object.keys(MUTASYONLAR).length} mutasyonun hepsi yakalandı.`);
process.exit(kacan ? 1 : 0);
