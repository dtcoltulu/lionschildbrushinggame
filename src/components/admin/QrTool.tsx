"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { QUIET_ZONE, buildQr, logoBox, qrToSvg, scaleForTarget } from "@/lib/qr";

interface Props {
  defaultUrl: string;
  logoPath: string;
  campaigns: { id: string; label: string }[];
  defaultCampaignId: string;
}

async function toDataUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function QrTool({ defaultUrl, logoPath, campaigns, defaultCampaignId }: Props) {
  const [base, setBase] = useState(defaultUrl);
  const [campaign, setCampaign] = useState(defaultCampaignId);
  const [useLogo, setUseLogo] = useState(true);
  const [logo, setLogo] = useState<string | null>(null);
  const [png, setPng] = useState<2048 | 4096>(2048);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    void toDataUrl(logoPath).then(setLogo);
  }, [logoPath]);

  // Varsayılan kampanya için URL kısa kalır (?k eklenmez).
  const url = useMemo(() => {
    const u = base.trim();
    return campaign === defaultCampaignId ? u : `${u}${u.includes("?") ? "&" : "?"}k=${encodeURIComponent(campaign)}`;
  }, [base, campaign, defaultCampaignId]);

  const matrix = useMemo(() => (url ? buildQr(url) : null), [url]);
  const activeLogo = useLogo ? logo : null;
  const svg = useMemo(() => (matrix ? qrToSvg(matrix, { logoDataUrl: activeLogo }) : ""), [matrix, activeLogo]);
  const isLocal = /localhost|127\.0\.0\.1|192\.168\.|\.local\b/.test(url);
  const isHttp = url.startsWith("http://") && !isLocal;

  async function downloadPng() {
    if (!matrix) return;
    setBusy(true);
    try {
      const scale = scaleForTarget(matrix, png);
      const total = matrix.size + QUIET_ZONE * 2;
      const px = total * scale;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = "#000";
      for (let r = 0; r < matrix.size; r++)
        for (let c = 0; c < matrix.size; c++)
          if (matrix.dark[r]![c]) ctx.fillRect((c + QUIET_ZONE) * scale, (r + QUIET_ZONE) * scale, scale, scale);
      if (activeLogo) {
        const box = logoBox(matrix.size);
        const x = (box.start + QUIET_ZONE - box.pad) * scale;
        const side = (box.modules + box.pad * 2) * scale;
        ctx.fillStyle = "#fff";
        ctx.fillRect(x, x, side, side);
        const img = new Image();
        await new Promise<void>((res) => {
          img.onload = () => res();
          img.onerror = () => res();
          img.src = activeLogo;
        });
        if (img.naturalWidth) ctx.drawImage(img, x + box.pad * scale, x + box.pad * scale, box.modules * scale, box.modules * scale);
      }
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (blob) download(`dis-kahramani-qr-${px}px.png`, blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-bold">
          Oyun adresi (QR içeriği)
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            inputMode="url"
            className="min-h-[52px] rounded-xl border-2 border-purple/40 bg-white px-3 text-lg"
            data-testid="qr-url"
          />
        </label>
        {campaigns.length > 1 && (
          <label className="flex flex-col gap-1 text-sm font-bold">
            Kampanya
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className="min-h-[52px] rounded-xl border-2 border-purple/40 bg-white px-3 text-lg">
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex min-h-[44px] items-center gap-3 font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={useLogo} onChange={(e) => setUseLogo(e.target.checked)} disabled={!logo} />
          Ortaya logo yerleştir {logo ? "" : "(logo dosyası bulunamadı)"}
        </label>
        <label className="flex flex-col gap-1 text-sm font-bold">
          PNG çözünürlüğü
          <select value={png} onChange={(e) => setPng(Number(e.target.value) as 2048 | 4096)} className="min-h-[52px] rounded-xl border-2 border-purple/40 bg-white px-3 text-lg">
            <option value={2048}>2048 px (A5–A4 baskı)</option>
            <option value={4096}>4096 px (büyük afiş)</option>
          </select>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-big btn-gold text-xl"
            data-testid="dl-svg"
            onClick={() => download("dis-kahramani-qr.svg", new Blob([svg], { type: "image/svg+xml" }))}
            disabled={!svg}
          >
            SVG indir
          </button>
          <button type="button" className="btn-big btn-gold text-xl" onClick={downloadPng} disabled={!matrix || busy} data-testid="dl-png">
            {busy ? "Hazırlanıyor…" : "PNG indir"}
          </button>
        </div>

        {isLocal && (
          <p role="alert" className="rounded-xl bg-coral/15 p-3 text-sm font-semibold ring-1 ring-coral">
            ⚠️ Bu adres yerel/geçici görünüyor. Baskıya göndermeden önce kalıcı alan adınızı girin (örn. https://alanadi.org/oyun).
          </p>
        )}
        {isHttp && (
          <p role="alert" className="rounded-xl bg-coral/15 p-3 text-sm font-semibold ring-1 ring-coral">
            ⚠️ Adres https ile başlamıyor.
          </p>
        )}
        <ul className="text-sm text-ink/70">
          <li>Adres uzunluğu: {url.length} karakter · QR boyutu: {matrix?.size}×{matrix?.size} modül · Hata düzeltme: H (%30)</li>
          <li>Basmadan önce mutlaka gerçek telefonlarla (iPhone + Android) okutup deneyin. Beyaz zemin üzerine siyah basın, en az 3×3 cm boyutunda kullanın.</li>
        </ul>
      </div>

      <div className="flex flex-col items-center gap-2">
        {svg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            alt={`${url} adresine giden QR kod`}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
            className="w-full max-w-[320px] rounded-2xl bg-white p-2 shadow ring-1 ring-purple/20"
            data-testid="qr-preview"
          />
        ) : (
          <p>Adres girin.</p>
        )}
        <code className="break-all text-center text-xs">{url}</code>
      </div>
    </div>
  );
}
