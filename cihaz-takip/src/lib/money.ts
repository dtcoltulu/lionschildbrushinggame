/**
 * Tutar girişi: "1.250,50", "1250,5", "1250.50", "1 250 TL", "₺1.250" kabul edilir.
 * Boş → null (tutar bilinmiyor). "0" → 0 (ücretsiz). Geçersiz → "invalid".
 */
export function parseMoney(input: string | number | null | undefined): number | null | "invalid" {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) / 100 : "invalid";
  let s = input.replace(/\s+/g, "").replace(/₺|TL|tl/g, "");
  if (s === "") return null;
  if (!/^[0-9.,]+$/.test(s)) return "invalid";
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Hangisi sonda ise ondalık ayırıcıdır; diğeri binlik ayırıcıdır.
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    s = s.split(thou).join("");
    if (s.split(dec).length > 2) return "invalid";
    s = s.replace(dec, ".");
  } else if (lastComma >= 0) {
    if (s.split(",").length > 2) {
      if (!/^\d{1,3}(,\d{3})+$/.test(s)) return "invalid";
      s = s.split(",").join("");
    } else s = s.replace(",", ".");
  } else if (lastDot >= 0) {
    // Yalnız nokta: "1.250" / "12.500.000" binlik; "1250.5" ondalık
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.split(".").join("");
    else if (s.split(".").length > 2) return "invalid";
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  const n = Number(s);
  if (!Number.isFinite(n) || n > 9_999_999_999) return "invalid";
  return Math.round(n * 100) / 100;
}

const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatTL(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return fmt.format(n);
}

/** Form alanında gösterim: 1250.5 → "1250,50" */
export function moneyInput(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return n.toFixed(2).replace(".", ",");
}
