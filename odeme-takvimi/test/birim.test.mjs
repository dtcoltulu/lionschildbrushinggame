// Saf yardımcıların birim testleri (tarih, dönem, tutar, kimlik).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './gas-mock.mjs';

const { ctx: g } = createEnv();

test('aya göre ilerleme ilk günün sayısına bağlı: 31 Ocak → 28 Şubat → 31 Mart; artık yıl', () => {
  const seq = (s, n) => Array.from({ length: n }, (_, i) => g.addMonthsAnchored_(s, i, +s.slice(8)));
  assert.deepEqual(seq('2027-01-31', 4), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  assert.deepEqual(seq('2028-01-31', 3), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.deepEqual(seq('2026-11-30', 4), ['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']);
  assert.deepEqual(seq('2026-12-15', 2), ['2026-12-15', '2027-01-15'], 'yıl geçişi');
});

test('açık ekstre dönemi: son ödeme günü bugün veya sonraysa bu ay, geçtiyse gelecek ay', () => {
  assert.equal(g.targetPeriod_('2026-10-31', 15), '2026-11');
  assert.equal(g.targetPeriod_('2026-11-15', 15), '2026-11', 'vade günü dönem hâlâ açık');
  assert.equal(g.targetPeriod_('2026-11-16', 15), '2026-12');
  assert.equal(g.targetPeriod_('2026-12-31', 31), '2026-12');
  assert.equal(g.targetPeriod_('2027-02-28', 31), '2027-02', 'Şubat’ta 31 → 28');
  assert.equal(g.targetPeriod_('2026-12-16', 15), '2027-01');
  assert.equal(g.dueForPeriod_('2026-11', 31), '2026-11-30');
});

test('dönem yazımları', () => {
  assert.equal(g.parsePeriod_('Kasım 2026'), '2026-11');
  assert.equal(g.parsePeriod_('kasim 2026'), '2026-11');
  assert.equal(g.parsePeriod_('ŞUBAT 2027'), '2027-02');
  assert.equal(g.parsePeriod_('2026-11'), '2026-11');
  assert.equal(g.parsePeriod_('11.2026'), '2026-11');
  assert.equal(g.parsePeriod_('3/6'), null);
  assert.equal(g.parsePeriod_(''), '');
  assert.equal(g.periodLabel_('2026-12'), 'Aralık 2026');
});

test('tutar ve tarih okuma', () => {
  assert.equal(g.parseAmount_(12345.678), 12345.68);
  assert.equal(g.parseAmount_('12.345,67'), 12345.67);
  assert.equal(g.parseAmount_('12345,67 TL'), 12345.67);
  assert.equal(g.parseAmount_(''), '');
  assert.equal(g.parseAmount_('abc'), null);
  assert.equal(g.parseAmount_(-5), null);
  assert.equal(g.formatMoney_(1234567.5, 'TRY'), '1.234.567,50 TL');
  assert.equal(g.formatMoney_(99, 'USD'), '99,00 USD');
  assert.equal(g.cellToYmd_('15.11.2026'), '2026-11-15');
  assert.equal(g.cellToYmd_('31.02.2026'), null);
  assert.equal(g.cellToYmd_(46341), '2026-11-15', 'E-Tablolar seri tarihi');
  assert.deepEqual({ ...g.parseTime_('9:30') }, { h: 9, m: 30 });
  assert.deepEqual({ ...g.parseTime_(0.4375) }, { h: 10, m: 30 });
  assert.equal(g.parseTime_('25:00'), null);
});

test('etkinlik saati gece yarısını geçerse ertesi güne taşar', () => {
  assert.equal(g.localTime_('2026-11-15', 600), '2026-11-15T10:00:00');
  assert.equal(g.localTime_('2026-12-31', 23 * 60 + 45 + 30), '2027-01-01T00:15:00');
});

test('etkinlik kimliği değişmez, Google kuralına uyar ve ödeme kimliğinden türetilir', () => {
  const a = g.eventIdFor_('kart-k1a2b3c4d5e6f-202611');
  assert.equal(a, g.eventIdFor_('kart-k1a2b3c4d5e6f-202611'));
  assert.notEqual(a, g.eventIdFor_('kart-k1a2b3c4d5e6f-202612'));
  assert.match(a, /^[0-9a-v]{5,1024}$/);
  assert.match(g.eventIdFor_('elle-ğüşİ'), /^[0-9a-v]{5,1024}$/);
  assert.match(g.eventIdFor_('x'.repeat(800)), /^[0-9a-v]{5,1024}$/);
});

test('hatırlatma kuralı', () => {
  const now = new Date('2026-10-31T19:00:00+03:00');
  const d = (paid, start = '2026-11-15T10:00:00') => ({ paid, startLocal: start });
  const full = { useDefault: false, overrides: [{ method: 'popup', minutes: 2880 }, { method: 'popup', minutes: 0 }] };
  const none = { useDefault: false, overrides: [] };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(g.remindersFor_({ state: '' }, d(false), now)), full, 'yeni açık etkinlik');
  assert.deepEqual(plain(g.remindersFor_({ state: '' }, d(true), now)), none);
  assert.deepEqual(plain(g.remindersFor_({ state: 'acik', start: '2026-11-15T10:00:00' }, d(true), now)), none, 'ödendi');
  assert.deepEqual(plain(g.remindersFor_({ state: 'odendi', start: '2026-11-15T10:00:00' }, d(false), now)), full, 'geri alındı, ikisi de gelecekte');
  assert.deepEqual(plain(g.remindersFor_({ state: 'odendi', start: '2026-11-01T10:00:00' }, d(false, '2026-11-01T10:00:00'), now)),
    { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }, 'geri alındı, yalnızca 0 dk gelecekte');
  assert.equal(g.remindersFor_({ state: 'acik', start: '2026-11-15T10:00:00' }, d(false), now), null, 'başka değişiklikte dokunma');
  assert.deepEqual(plain(g.remindersFor_({ state: 'acik', start: '2026-11-15T10:00:00' }, d(false, '2026-11-16T10:00:00'), now)), full, 'tarih değişti');
});
