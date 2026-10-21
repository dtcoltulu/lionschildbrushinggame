"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, uploadFile, type ApiError } from "./client";
import { ErrorBanner } from "./form";

export interface FileItem {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedByName: string;
}

/** Fotoğraf / belge ekleme. Telefonda kamera açılır; fotoğraf yüklenmeden önce küçültülür. Hasta bilgisi içeren fotoğraf eklemeyin. */
export function Files({ entity, entityId, files, canUpload, accept = "image/*", label = "Fotoğraf ekle", pdf }: { entity: string; entityId: string; files: FileItem[]; canUpload: boolean; accept?: string; label?: string; pdf?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div className="space-y-3">
      {files.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {files.map((f) => (
            <li key={f.id} className="card overflow-hidden">
              <a href={`/api/dosyalar/${f.id}`} target="_blank" rel="noreferrer" className="block">
                {f.mime.startsWith("image/") && f.mime !== "image/heic" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- yetki kontrollü API'den gelen fotoğraf
                  <img src={`/api/dosyalar/${f.id}`} alt={f.filename} className="h-28 w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-28 items-center justify-center bg-slate-50 text-3xl" aria-hidden>📄</div>
                )}
                <div className="truncate px-2 py-1 text-xs text-muted">{f.filename}</div>
              </a>
              {canUpload && (
                <button
                  type="button"
                  className="w-full border-t border-slate-100 px-2 py-1 text-xs font-semibold text-red-700"
                  onClick={async () => {
                    if (!window.confirm(`“${f.filename}” kaldırılsın mı?`)) return;
                    const r = await callApi("DELETE", `/api/dosyalar/${f.id}`);
                    if (!r.ok) setErr(r);
                    else router.refresh();
                  }}
                >
                  Kaldır
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Dosya yok.</p>
      )}
      <ErrorBanner error={err} />
      {canUpload && (
        <label className={`btn btn-secondary ${busy ? "opacity-60" : ""}`}>
          {busy ? "Yükleniyor…" : label}
          <input
            type="file"
            className="sr-only"
            accept={pdf ? `${accept},application/pdf` : accept}
            capture={pdf ? undefined : "environment"}
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              setErr(null);
              const r = await uploadFile(entity, entityId, file);
              setBusy(false);
              if (!r.ok) setErr(r);
              else router.refresh();
            }}
          />
        </label>
      )}
      {canUpload && <p className="text-xs text-muted">Fotoğrafta hasta adı, yüzü veya protokol bilgisi olmamalıdır.</p>}
    </div>
  );
}
