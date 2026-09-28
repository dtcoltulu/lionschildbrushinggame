import qrcode from "qrcode-generator";

/** Merkezdeki logo, sembol genişliğinin en fazla bu oranı kadar olur (H düzeyi %30 hatayı tolere eder). */
export const MAX_LOGO_RATIO = 0.22;
export const QUIET_ZONE = 4;

export interface QrMatrix {
  size: number;
  dark: boolean[][];
}

/** Hata düzeltme seviyesi H (en yüksek): logo ve baskı bozulmalarına dayanıklı. */
export function buildQr(text: string): QrMatrix {
  const qr = qrcode(0, "H");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  const dark = Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => qr.isDark(r, c)));
  return { size, dark };
}

/** Logo kutusu: modül birimiyle, ortalanmış, tek sayıda modül (merkez hizalı) + 1 modül beyaz pay. */
export function logoBox(size: number, ratio = MAX_LOGO_RATIO): { start: number; modules: number; pad: number } {
  let modules = Math.floor(size * Math.min(ratio, MAX_LOGO_RATIO));
  if (modules % 2 === 0) modules -= 1;
  modules = Math.max(3, modules);
  const start = (size - modules) / 2;
  return { start, modules, pad: 1 };
}

export interface SvgOptions {
  fg?: string;
  bg?: string;
  /** data: URL (svg/png). Verilmezse logo çizilmez. */
  logoDataUrl?: string | null;
}

export function qrToSvg(m: QrMatrix, opts: SvgOptions = {}): string {
  const { fg = "#000000", bg = "#ffffff", logoDataUrl = null } = opts;
  const total = m.size + QUIET_ZONE * 2;
  const box = logoDataUrl ? logoBox(m.size) : null;
  let path = "";
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (m.dark[r]![c]) {
        let end = c;
        while (end + 1 < m.size && m.dark[r]![end + 1]) end++;
        path += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h${end - c + 1}v1h${-(end - c + 1)}z`;
        c = end + 1;
      } else c++;
    }
  }
  let logo = "";
  if (box && logoDataUrl) {
    const x = box.start + QUIET_ZONE - box.pad;
    const side = box.modules + box.pad * 2;
    logo =
      `<rect x="${x}" y="${x}" width="${side}" height="${side}" rx="1" fill="${bg}"/>` +
      `<image href="${logoDataUrl}" x="${x + box.pad}" y="${x + box.pad}" width="${box.modules}" height="${box.modules}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * 10}" height="${total * 10}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${bg}"/>` +
    `<path d="${path}" fill="${fg}"/>${logo}</svg>`
  );
}

/** Test/PNG için ham raster (gri tonlu RGBA). Logo bölgesi ortada gri bir blokla temsil edilir (en kötü durum). */
export function qrToRaster(m: QrMatrix, scale: number, withLogoBlock: boolean) {
  const total = m.size + QUIET_ZONE * 2;
  const px = total * scale;
  const data = new Uint8ClampedArray(px * px * 4);
  const box = withLogoBlock ? logoBox(m.size) : null;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - QUIET_ZONE;
      const my = Math.floor(y / scale) - QUIET_ZONE;
      let v = 255;
      if (mx >= 0 && my >= 0 && mx < m.size && my < m.size) v = m.dark[my]![mx] ? 0 : 255;
      if (box) {
        const lo = box.start - box.pad;
        const hi = box.start + box.modules + box.pad;
        if (mx >= lo && mx < hi && my >= lo && my < hi) {
          const inner = mx >= box.start && mx < box.start + box.modules && my >= box.start && my < box.start + box.modules;
          v = inner ? 96 : 255;
        }
      }
      const i = (y * px + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: px, height: px };
}

export function scaleForTarget(m: QrMatrix, targetPx: number): number {
  return Math.max(1, Math.floor(targetPx / (m.size + QUIET_ZONE * 2)));
}
