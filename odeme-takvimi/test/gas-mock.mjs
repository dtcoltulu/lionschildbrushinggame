// Google Apps Script servislerinin bellek içi taklidi (yalnızca testler için).
// Kod.gs'yi değiştirmeden bir vm bağlamında çalıştırır. Gerçek Google'a bağlanmaz.
//
// Bilinçli olarak "zor" davranışlar:
//  - Onay kutusu doğrulaması uygulanan boş hücreler FALSE olur (gerçek E-Tablolar'daki getLastRow tuzağı).
//  - Düz metin (@) biçimi olmayan hücreye yazılan "2026-11", "3/6", "1e5" gibi metinler tarih/sayıya çevrilir.
//  - Silinen etkinlik "cancelled" olarak kalır; aynı kimlikle yeniden eklemek 409 verir, patch ile geri gelir.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KOD_PATH = process.env.KOD_GS || path.join(HERE, '..', 'apps-script', 'Kod.gs');

const TZ_OFFSETS = { 'Europe/Istanbul': 3 * 3600 * 1000, UTC: 0, 'Etc/UTC': 0 };
function offsetOf(tz) {
  if (!(tz in TZ_OFFSETS)) throw new Error('mock: desteklenmeyen saat dilimi ' + tz);
  return TZ_OFFSETS[tz];
}
const pad = (n, w = 2) => String(n).padStart(w, '0');

export function formatDate(date, tz, fmt) {
  const d = new Date(date.getTime() + offsetOf(tz));
  const map = {
    yyyy: pad(d.getUTCFullYear(), 4), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()),
  };
  let out = '';
  for (let i = 0; i < fmt.length;) {
    if (fmt[i] === "'") { const j = fmt.indexOf("'", i + 1); out += fmt.slice(i + 1, j); i = j + 1; continue; }
    const tok = ['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss'].find((t) => fmt.startsWith(t, i));
    if (tok) { out += map[tok]; i += tok.length; } else { out += fmt[i]; i++; }
  }
  return out;
}

export function parseDate(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(str);
  if (!m) throw new Error('mock parseDate: ' + str);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - offsetOf(tz));
}

/** Test yardımcısı: '2026-11-15' → o günün İstanbul gece yarısı. */
export const day = (ymd) => parseDate(ymd, 'Europe/Istanbul');

const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const isBlank = (v) => v === '' || v === null || v === undefined;

function chainable(target) {
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => proxy; // biçimlendirme gibi testte önemsiz yöntemler: zincirlenebilir
    },
  });
  return proxy;
}

class MockRange {
  constructor(sheet, row, col, nr = 1, nc = 1) {
    if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error(`mock: geçersiz aralık ${row},${col},${nr},${nc}`);
    Object.assign(this, { sheet, row, col, nr, nc });
    return chainable(this);
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.sheet.get(this.row, this.col); }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((l) => l.length !== this.nc)) throw new Error('mock: setValues boyutu uyuşmuyor');
    vals.forEach((l, r) => l.forEach((v, c) => this.sheet.write(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) {
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.write(this.row + r, this.col + c, v);
    return this;
  }
  setDataValidation(rule) {
    this.each((r, c) => {
      const k = `${r},${c}`;
      if (rule) this.sheet.rules.set(k, rule); else this.sheet.rules.delete(k);
      if (rule && rule.type === 'checkbox' && isBlank(this.sheet.get(r, c))) this.sheet.set(r, c, false);
    });
    return this;
  }
  clearDataValidations() { return this.setDataValidation(null); }
  getDataValidation() { return this.sheet.rules.get(`${this.row},${this.col}`) || null; }
  setNumberFormat(fmt) { this.each((r, c) => this.sheet.formats.set(`${r},${c}`, fmt)); return this; }
  setNote(n) { this.sheet.notes.set(`${this.row},${this.col}`, n); return this; }
  each(fn) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) fn(this.row + r, this.col + c); }
}

class MockSheet {
  constructor(ss, name) {
    Object.assign(this, { ss, name, cells: [], maxRows: 1000, maxCols: 26, hidden: new Set(), rules: new Map(), formats: new Map(), notes: new Map(), frozenRows: 0, frozenCols: 0 });
    return chainable(this);
  }
  getName() { return this.name; }
  getParent() { return this.ss; }
  get(r, c) { const row = this.cells[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  set(r, c, v) {
    if (r > this.maxRows) this.maxRows = r;
    if (c > this.maxCols) this.maxCols = c;
    while (this.cells.length < r) this.cells.push([]);
    this.cells[r - 1][c - 1] = v;
  }
  /** Betik/kullanıcı yazımı: düz metin biçimi yoksa E-Tablolar gibi metni tarih/sayıya çevirir. */
  write(r, c, v) {
    if (typeof v === 'string' && this.formats.get(`${r},${c}`) !== '@') {
      let m;
      if ((m = /^(\d{4})-(\d{1,2})$/.exec(v))) v = day(`${m[1]}-${pad(+m[2])}-01`);
      else if ((m = /^(\d{1,2})\/(\d{1,2})$/.exec(v)) && +m[2] <= 12 && +m[1] <= 31) v = day(`2026-${pad(+m[2])}-${pad(+m[1])}`);
      else if ((m = /^(\d{1,2}):(\d{2})$/.exec(v))) v = new Date(Date.UTC(1899, 11, 30, +m[1], +m[2]) - offsetOf('Europe/Istanbul')); // saat değeri
      else if (/^\d+(\.\d+)?(e\d+)?$/i.test(v)) v = Number(v);
    }
    this.set(r, c, v);
  }
  getRange(r, c, nr, nc) { return new MockRange(this, r, c, nr, nc); }
  getLastRow() {
    for (let r = this.cells.length; r >= 1; r--) if ((this.cells[r - 1] || []).some((v) => !isBlank(v))) return r; // FALSE da doludur
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.cells.forEach((row) => row.forEach((v, i) => { if (!isBlank(v) && i + 1 > max) max = i + 1; }));
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  insertColumnsAfter(after, n) { this.maxCols += n; return this; }
  deleteRow(r) {
    this.cells.splice(r - 1, 1);
    for (const map of [this.rules, this.formats, this.notes]) {
      const moved = new Map();
      for (const [k, v] of map) {
        const [rr, cc] = k.split(',').map(Number);
        if (rr < r) moved.set(k, v); else if (rr > r) moved.set(`${rr - 1},${cc}`, v);
      }
      map.clear();
      for (const [k, v] of moved) map.set(k, v);
    }
    this.maxRows -= 1;
    return this;
  }
  hideColumns(c, n = 1) { for (let i = 0; i < n; i++) this.hidden.add(c + i); return this; }
  setFrozenRows(n) { this.frozenRows = n; return this; }
  setFrozenColumns(n) { this.frozenCols = n; return this; }
}

class MockSpreadsheet {
  constructor() {
    this.sheets = [];
    this.tz = 'UTC';
    this.locale = 'en_US';
    this.sheets.push(new MockSheet(this, 'Sayfa1'));
  }
  getSheetByName(n) { return this.sheets.find((s) => s.getName() === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('mock: sekme zaten var ' + n);
    const s = new MockSheet(this, n);
    this.sheets.push(s);
    return s;
  }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getSpreadsheetTimeZone() { return this.tz; }
  setSpreadsheetLocale(l) { this.locale = l; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/TEST/edit'; }
  getId() { return 'TEST'; }
}

function apiError(op, code, message) {
  const e = new Error(`API call to calendar.${op} failed with error: ${message}`);
  e.details = { code, message };
  return e;
}

const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}

class MockCalendar {
  constructor() {
    this.calendars = new Map();
    this.calls = [];
    this.failures = []; // { op, times, error }
    this.seq = 0;
    const self = this;
    this.Calendars = {
      insert(res) { self.call('calendars.insert'); const id = `cal${++self.seq}@group.calendar.google.com`; self.calendars.set(id, { id, summary: res.summary, timeZone: res.timeZone, description: res.description, events: new Map() }); return { id, summary: res.summary, timeZone: res.timeZone }; },
      get(id) { self.call('calendars.get'); const c = self.calendars.get(id); if (!c) throw apiError('calendars.get', 404, 'Not Found'); return { id: c.id, summary: c.summary, timeZone: c.timeZone }; },
      patch(res, id) { self.call('calendars.patch'); const c = self.calendars.get(id); if (!c) throw apiError('calendars.patch', 404, 'Not Found'); Object.assign(c, res); return { id, summary: c.summary, timeZone: c.timeZone }; },
    };
    this.Events = {
      insert(res, calId) {
        self.call('events.insert', res);
        const c = self.cal(calId, 'events.insert');
        const id = res.id || 'rnd' + crypto.randomBytes(8).toString('hex');
        if (c.events.has(id)) throw apiError('events.insert', 409, 'The requested identifier already exists.');
        const ev = clone({ ...res, id, status: 'confirmed' });
        c.events.set(id, ev);
        return clone(ev);
      },
      patch(res, calId, evId) {
        self.call('events.patch', res);
        const c = self.cal(calId, 'events.patch');
        const ev = c.events.get(evId);
        if (!ev) throw apiError('events.patch', 404, 'Not Found');
        const r = clone(res);
        // İsteğe bağlı kötümser davranış: PATCH boş hatırlatma listesini yok sayar.
        if (self.ignoreEmptyOverridesOnPatch && r.reminders && Array.isArray(r.reminders.overrides) && !r.reminders.overrides.length) delete r.reminders;
        deepMerge(ev, r);
        return clone(ev);
      },
      update(res, calId, evId) {
        self.call('events.update', res);
        const c = self.cal(calId, 'events.update');
        if (!c.events.has(evId)) throw apiError('events.update', 404, 'Not Found');
        const ev = clone({ ...res, id: evId, status: res.status || 'confirmed' });
        c.events.set(evId, ev);
        return clone(ev);
      },
      get(calId, evId) {
        self.call('events.get');
        const ev = self.cal(calId, 'events.get').events.get(evId);
        if (!ev) throw apiError('events.get', 404, 'Not Found');
        return clone(ev);
      },
      list(calId, opts = {}) {
        self.call('events.list');
        const c = self.cal(calId, 'events.list');
        let items = [...c.events.values()].filter((e) => opts.showDeleted || e.status !== 'cancelled');
        if (opts.privateExtendedProperty) {
          const [k, v] = opts.privateExtendedProperty.split('=');
          items = items.filter((e) => e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private[k] === v);
        }
        const start = opts.pageToken ? Number(opts.pageToken) : 0;
        const max = Math.min(opts.maxResults || 250, 3); // sayfalamayı sınamak için küçük sayfa
        const page = items.slice(start, start + max).map(clone);
        return { items: page, nextPageToken: start + max < items.length ? String(start + max) : undefined };
      },
      remove(calId, evId) {
        self.call('events.remove');
        const ev = self.cal(calId, 'events.remove').events.get(evId);
        if (!ev) throw apiError('events.delete', 404, 'Not Found');
        if (ev.status === 'cancelled') throw apiError('events.delete', 410, 'Resource has been deleted');
        ev.status = 'cancelled';
      },
    };
  }
  call(op, body) {
    this.calls.push({ op, body: clone(body) });
    const f = this.failures.find((x) => x.op === op && x.times > 0);
    if (f) { f.times--; throw f.error || apiError(op, 500, 'Backend Error'); }
  }
  cal(id, op) { const c = this.calendars.get(id); if (!c) throw apiError(op, 404, 'Not Found'); return c; }
  failNext(op, times = 1, error) { this.failures.push({ op, times, error }); }
  writes() { return this.calls.filter((c) => /insert|patch|update|remove/.test(c.op)).length; }
}

class MockScriptApp {
  constructor() {
    this.triggers = [];
    this.seq = 0;
    this.EventType = { ON_EDIT: 'ON_EDIT', ON_CHANGE: 'ON_CHANGE', CLOCK: 'CLOCK', ON_OPEN: 'ON_OPEN' };
  }
  getProjectTriggers() { return this.triggers.map((t) => t.api); }
  deleteTrigger(api) { this.triggers = this.triggers.filter((t) => t.api !== api); }
  newTrigger(fn) {
    const self = this;
    const spec = { fn };
    const create = () => {
      const t = { ...spec, uid: String(++self.seq) };
      t.api = { getHandlerFunction: () => t.fn, getEventType: () => t.type, getUniqueId: () => t.uid };
      self.triggers.push(t);
      return t.api;
    };
    const clock = { everyDays(n) { spec.everyDays = n; return clock; }, atHour(h) { spec.atHour = h; return clock; }, nearMinute(m) { spec.nearMinute = m; return clock; }, inTimezone(z) { spec.tz = z; return clock; }, after(ms) { spec.after = ms; return clock; }, create };
    return {
      forSpreadsheet() {
        return { onEdit() { spec.type = 'ON_EDIT'; return { create }; }, onChange() { spec.type = 'ON_CHANGE'; return { create }; }, onOpen() { spec.type = 'ON_OPEN'; return { create }; } };
      },
      timeBased() { spec.type = 'CLOCK'; return clock; },
    };
  }
}

class MockProps {
  constructor() { this.map = new Map(); }
  getProperty(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setProperty(k, v) { this.map.set(k, String(v)); return this; }
  deleteProperty(k) { this.map.delete(k); return this; }
  getProperties() { return Object.fromEntries(this.map); }
}

class Builder {
  constructor() { this.rule = {}; }
  requireCheckbox() { this.rule.type = 'checkbox'; return this; }
  requireValueInList(list, dropdown) { Object.assign(this.rule, { type: 'list', list: [...list], dropdown }); return this; }
  requireDate() { this.rule.type = 'date'; return this; }
  requireNumberBetween(a, b) { Object.assign(this.rule, { type: 'between', a, b }); return this; }
  requireNumberGreaterThanOrEqualTo(a) { Object.assign(this.rule, { type: 'gte', a }); return this; }
  setAllowInvalid(x) { this.rule.allowInvalid = x; return this; }
  setHelpText(t) { this.rule.help = t; return this; }
  build() { return { ...this.rule }; }
}

/** Yeni bir sahte Google ortamı kurar ve Kod.gs'yi içine yükler. */
export function createEnv({ now = '2026-10-31T19:00:00+03:00' } = {}) {
  const state = { now: new Date(now) };
  const ss = new MockSpreadsheet();
  const calendar = new MockCalendar();
  const scriptApp = new MockScriptApp();
  const props = new MockProps();
  const logs = [];
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ss, newDataValidation: () => new Builder(), flush() {} },
    Calendar: { Calendars: calendar.Calendars, Events: calendar.Events },
    ScriptApp: scriptApp,
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate, parseDate, sleep() {} },
    Session: { getScriptTimeZone: () => 'Europe/Istanbul' },
    Logger: { log: (m) => logs.push(String(m)) },
    console,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(KOD_PATH, 'utf8'), context, { filename: 'Kod.gs' });
  context.now_ = () => new Date(state.now.getTime());

  const env = {
    ctx: context, ss, calendar, scriptApp, props, logs,
    setNow(iso) { state.now = new Date(iso); },
    now: () => new Date(state.now.getTime()),
    run(fn, ...args) { return context[fn](...args); },
    sheet(name) { const s = ss.getSheetByName(name); if (!s) throw new Error('sekme yok: ' + name); return s; },
    header(name) { const s = env.sheet(name); return s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; },
    col(name, title) { const i = env.header(name).indexOf(title); if (i < 0) throw new Error(`başlık yok: ${name}/${title}`); return i + 1; },
    /** Boş olmayan satırları başlık → değer nesnesi olarak döndürür. */
    table(name) {
      const s = env.sheet(name);
      const h = env.header(name);
      const out = [];
      for (let r = 2; r <= s.getLastRow(); r++) {
        const vals = h.map((_, i) => s.get(r, i + 1));
        if (vals.every((v) => isBlank(v) || v === false)) continue;
        const o = { _row: r };
        h.forEach((t, i) => { o[t] = vals[i]; });
        out.push(o);
      }
      return out;
    },
    firstEmptyRow(name) {
      const s = env.sheet(name);
      for (let r = 2; ; r++) {
        const row = s.cells[r - 1] || [];
        if (row.every((v) => isBlank(v) || v === false)) return r;
      }
    },
    fire(type, e) {
      scriptApp.triggers.filter((t) => t.type === type).forEach((t) => context[t.fn](e));
    },
    /** Telefondaki kullanıcı gibi bir hücreyi düzenler ve kurulu düzenleme tetikleyicisini çalıştırır. */
    edit(name, row, title, value) {
      const s = env.sheet(name);
      const c = env.col(name, title);
      s.write(row, c, value);
      env.fire('ON_EDIT', { range: s.getRange(row, c), value: String(value), source: ss });
    },
    /** Kullanıcı ilk boş satıra hücre hücre yazar (her hücre ayrı bir düzenleme olayıdır). */
    addRow(name, obj) {
      const r = env.firstEmptyRow(name);
      Object.entries(obj).forEach(([t, v]) => env.edit(name, r, t, v));
      return r;
    },
    setting(title, value) {
      const s = env.sheet('Ayarlar');
      for (let r = 2; r <= s.getLastRow(); r++) {
        if (s.get(r, 1) === title) {
          if (value === undefined) return s.get(r, 2);
          s.write(r, 2, value);
          env.fire('ON_EDIT', { range: s.getRange(r, 2), value: String(value), source: ss });
          return value;
        }
      }
      throw new Error('ayar yok: ' + title);
    },
    deleteRow(name, row) {
      env.sheet(name).deleteRow(row);
      env.fire('ON_CHANGE', { changeType: 'REMOVE_ROW', source: ss });
    },
    /** Kurulu günlük tetikleyiciyi çalıştırır (kullanıcı tabloyu açmadan). */
    daily() {
      const t = scriptApp.triggers.filter((x) => x.type === 'CLOCK' && x.fn === 'gunlukEsitle');
      if (t.length !== 1) throw new Error('günlük tetikleyici sayısı ' + t.length);
      context[t[0].fn]({});
    },
    triggerCounts() {
      const c = {};
      scriptApp.triggers.forEach((t) => { c[t.fn] = (c[t.fn] || 0) + 1; });
      return c;
    },
    calId() { return props.getProperty('takvimId'); },
    allEvents() { const c = calendar.calendars.get(env.calId()); return c ? [...c.events.values()] : []; },
    events(kind = 'odeme') {
      return env.allEvents().filter((e) => e.status !== 'cancelled' && e.extendedProperties?.private?.tur === kind);
    },
  };
  return env;
}
