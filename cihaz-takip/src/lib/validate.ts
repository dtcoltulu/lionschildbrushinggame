import { formatDate, isValidIsoDate } from "./dates";
import { parseMoney } from "./money";
import { cleanLine } from "./normalize";

/** Alan adı → Türkçe hata mesajı. Her mesaj hangi alanda sorun olduğunu söyler. */
export type FieldErrors = Record<string, string>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  return v;
}

/** Gövdeden alanları okuyan, hataları biriktiren küçük yardımcı. */
export class Reader {
  constructor(
    private readonly body: Record<string, unknown>,
    private readonly prefix = "",
    readonly errors: FieldErrors = {},
  ) {}

  private key(field: string) {
    return this.prefix ? `${this.prefix}.${field}` : field;
  }

  has(field: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.body, field);
  }

  error(field: string, message: string) {
    if (!this.errors[this.key(field)]) this.errors[this.key(field)] = message;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  /** Zorunlu tek satırlık metin. */
  text(field: string, label: string, opts: { max?: number; min?: number } = {}): string {
    const raw = asString(this.body[field]);
    const v = raw === null ? "" : cleanLine(raw);
    const min = opts.min ?? 1;
    if (v.length < min) {
      this.error(field, min > 1 ? `${label}: en az ${min} karakter yazın.` : `${label} boş bırakılamaz.`);
      return v;
    }
    if (opts.max && v.length > opts.max) this.error(field, `${label} en fazla ${opts.max} karakter olabilir.`);
    return v;
  }

  /** İsteğe bağlı metin (boş → null). multiline: satır sonları korunur. */
  optText(field: string, label: string, opts: { max?: number; multiline?: boolean } = {}): string | null {
    const raw = asString(this.body[field]);
    if (raw === null) {
      if (this.body[field] !== null && this.body[field] !== undefined) this.error(field, `${label} geçersiz.`);
      return null;
    }
    const v = opts.multiline ? raw.replace(/\r\n/g, "\n").trim() : cleanLine(raw);
    if (!v) return null;
    const max = opts.max ?? (opts.multiline ? 2000 : 200);
    if (v.length > max) this.error(field, `${label} en fazla ${max} karakter olabilir.`);
    return v;
  }

  /** Zorunlu çok satırlı metin. */
  longText(field: string, label: string, max = 2000): string {
    const v = this.optText(field, label, { multiline: true, max });
    if (!v) {
      this.error(field, `${label} boş bırakılamaz.`);
      return "";
    }
    return v;
  }

  optId(field: string, label: string): string | null {
    const v = this.body[field];
    if (v === null || v === undefined || v === "") return null;
    if (!isUuid(v)) {
      this.error(field, `${label}: listeden geçerli bir seçim yapın.`);
      return null;
    }
    return v;
  }

  id(field: string, label: string): string {
    const v = this.optId(field, label);
    if (!v && !this.errors[this.key(field)]) this.error(field, `${label} seçilmelidir.`);
    return v ?? "";
  }

  ids(field: string, label: string): string[] {
    const v = this.body[field];
    if (v === null || v === undefined) return [];
    if (!Array.isArray(v) || !v.every(isUuid)) {
      this.error(field, `${label}: listeden geçerli seçimler yapın.`);
      return [];
    }
    return [...new Set(v as string[])];
  }

  oneOf<T extends string>(field: string, label: string, values: readonly T[], fallback?: T): T {
    const v = this.body[field];
    if ((v === undefined || v === null || v === "") && fallback !== undefined) return fallback;
    if (typeof v !== "string" || !values.includes(v as T)) {
      this.error(field, `${label}: geçerli bir seçenek seçin.`);
      return (fallback ?? values[0]) as T;
    }
    return v as T;
  }

  optOneOf<T extends string>(field: string, label: string, values: readonly T[]): T | null {
    const v = this.body[field];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || !values.includes(v as T)) {
      this.error(field, `${label}: geçerli bir seçenek seçin.`);
      return null;
    }
    return v as T;
  }

  bool(field: string, fallback = false): boolean {
    const v = this.body[field];
    if (v === undefined || v === null) return fallback;
    return v === true || v === "true" || v === "1" || v === 1;
  }

  int(field: string, label: string, min: number, max: number, fallback: number): number {
    const v = this.body[field];
    if (v === undefined || v === null || v === "") return fallback;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      this.error(field, `${label} ${min} ile ${max} arasında bir tam sayı olmalı.`);
      return fallback;
    }
    return n;
  }

  /**
   * Tarih (YYYY-MM-DD). notAfter verilirse o günden sonrası reddedilir
   * (gerçekleşmiş tarihler gelecekte olamaz).
   */
  optDate(field: string, label: string, opts: { notAfter?: string } = {}): string | null {
    const raw = asString(this.body[field]);
    if (raw === null || raw.trim() === "") return null;
    const v = raw.trim();
    if (!isValidIsoDate(v)) {
      this.error(field, `${label} geçerli bir tarih değil.`);
      return null;
    }
    if (v < "2000-01-01") {
      this.error(field, `${label} 2000 yılından önce olamaz.`);
      return null;
    }
    if (opts.notAfter && v > opts.notAfter) {
      this.error(field, `${label} ileri bir tarih olamaz (bugün: ${formatDate(opts.notAfter)}).`);
      return null;
    }
    if (v > "2100-12-31") {
      this.error(field, `${label} geçerli bir tarih değil.`);
      return null;
    }
    return v;
  }

  date(field: string, label: string, opts: { notAfter?: string } = {}): string {
    const v = this.optDate(field, label, opts);
    if (!v && !this.errors[this.key(field)]) this.error(field, `${label} boş bırakılamaz.`);
    return v ?? "";
  }

  /** Tutar: boş → null (bilinmiyor), 0 → ücretsiz. */
  optMoney(field: string, label: string): number | null {
    const v = this.body[field];
    if (v !== null && v !== undefined && typeof v !== "string" && typeof v !== "number") {
      this.error(field, `${label} geçersiz.`);
      return null;
    }
    const n = parseMoney(v as string | number | null | undefined);
    if (n === "invalid") {
      this.error(field, `${label} geçerli bir tutar değil. Örnek: 1.250,50`);
      return null;
    }
    return n;
  }

  optEmail(field: string, label: string): string | null {
    const v = this.optText(field, label, { max: 200 });
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      this.error(field, `${label} geçerli bir e-posta adresi değil.`);
      return null;
    }
    return v ? v.toLowerCase() : null;
  }

  version(): number {
    const v = this.body.version;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 1) {
      this.error("version", "Kayıt sürümü eksik. Sayfayı yenileyip tekrar deneyin.");
      return 0;
    }
    return n;
  }

  /** İç içe nesne için ayrı okuyucu (hatalar "ust.alan" anahtarıyla bu okuyucuya yazılır). */
  nested(field: string): Reader {
    const v = this.body[field];
    const obj = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    return new Reader(obj, this.key(field), this.errors);
  }
}

export function asBody(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
