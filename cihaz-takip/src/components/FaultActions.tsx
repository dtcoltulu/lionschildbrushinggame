"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatDate } from "@/lib/dates";
import { callApi, type ApiError } from "./client";
import { ErrorBanner, TextArea } from "./form";

interface Info {
  id: string;
  deviceCode: string;
  deviceName: string;
  description: string;
  noticedOn: string;
  deleted: boolean;
  deletionRequested: boolean;
}

/**
 * Silme işlemleri. Silmeden önce cihaz ve arıza bilgisi gösterilerek onay alınır.
 * Personel: "Silinmesini iste" (yöneticiye bildirir). Yönetici: sil / geri al / kalıcı sil / talebi reddet.
 */
export function FaultActions({ info, isAdmin }: { info: Info; isAdmin: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<"request" | "delete" | "purge" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const open = (k: "request" | "delete" | "purge") => {
    setKind(k);
    setReason("");
    setErr(null);
    dialog.current?.showModal();
  };

  async function run(method: string, url: string, body?: unknown, after?: () => void) {
    setBusy(true);
    setErr(null);
    const r = await callApi(method, url, body);
    setBusy(false);
    if (!r.ok) {
      setErr(r);
      return;
    }
    dialog.current?.close();
    after?.();
  }

  const confirm = () => {
    if (kind === "request") void run("POST", `/api/arizalar/${info.id}/silme-talebi`, { reason }, () => {
      setMsg("Silme talebi yöneticiye iletildi.");
      router.refresh();
    });
    if (kind === "delete") void run("POST", `/api/arizalar/${info.id}/sil`, { reason }, () => {
      router.push(`/arizalar?gorunum=silinen&silindi=1`);
      router.refresh();
    });
    if (kind === "purge") void run("DELETE", `/api/arizalar/${info.id}`, undefined, () => {
      router.push(`/arizalar?gorunum=silinen&kalici=1`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 font-semibold text-emerald-900" role="status">{msg}</p>}
      {!kind && err && <ErrorBanner error={err} />}
      <div className="flex flex-wrap gap-2">
        {!info.deleted && !isAdmin && !info.deletionRequested && (
          <button type="button" className="btn btn-danger" onClick={() => open("request")}>Yanlış kayıt – silinmesini iste</button>
        )}
        {!info.deleted && !isAdmin && info.deletionRequested && <p className="text-muted">Silme talebi yöneticide.</p>}
        {!info.deleted && isAdmin && (
          <button type="button" className="btn btn-danger" onClick={() => open("delete")}>Arıza kaydını sil</button>
        )}
        {!info.deleted && isAdmin && info.deletionRequested && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run("DELETE", `/api/arizalar/${info.id}/silme-talebi`, undefined, () => router.refresh())}>
            Silme talebini reddet
          </button>
        )}
        {info.deleted && isAdmin && (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run("POST", `/api/arizalar/${info.id}/geri-al`, undefined, () => router.refresh())}>
              Silmeyi geri al
            </button>
            <button type="button" className="btn btn-danger" onClick={() => open("purge")}>Kalıcı olarak sil</button>
          </>
        )}
      </div>
      <dialog ref={dialog} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 backdrop:bg-black/40" onClose={() => setKind(null)}>
        <div className="space-y-4 p-5">
          <h2 className="text-xl font-bold">
            {kind === "request" ? "Silinmesini iste" : kind === "purge" ? "Kalıcı olarak silinsin mi?" : "Arıza kaydı silinsin mi?"}
          </h2>
          <div className="rounded-xl bg-slate-50 p-3 text-[15px]">
            <div><span className="font-mono font-bold text-brand">{info.deviceCode}</span> {info.deviceName}</div>
            <div className="mt-1">“{info.description}”</div>
            <div className="mt-1 text-sm text-muted">Fark edildi: {formatDate(info.noticedOn)}</div>
          </div>
          <p className="text-[15px]">
            {kind === "request" && "Kayıt silinmez; yönetici inceler. Nedenini kısaca yazın."}
            {kind === "delete" && "Cihaz kartı korunur. Bu arıza; tamire gidiş, maliyet ve neden analizlerinden çıkar. Yönetici sonradan geri alabilir. İşlem kim/ne zaman bilgisiyle kaydedilir."}
            {kind === "purge" && "Bu işlem geri alınamaz. Kayıt ve servis gidişleri tamamen silinir; işlem geçmişinde yalnızca özet kalır."}
          </p>
          {kind !== "purge" && (
            <TextArea
              label={kind === "request" ? "Neden?" : "Silme nedeni (isteğe bağlı)"}
              required={kind === "request"}
              value={reason}
              onChange={setReason}
              error={err?.fieldErrors.reason}
              placeholder="Örn. deneme amaçlı girildi / yanlış cihaz seçildi"
            />
          )}
          {err && !err.fieldErrors.reason && <ErrorBanner error={err} />}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>Vazgeç</button>
            <button type="button" className={kind === "request" ? "btn btn-primary" : "btn btn-danger-solid"} disabled={busy} onClick={confirm}>
              {busy ? "İşleniyor…" : kind === "request" ? "Talebi gönder" : kind === "purge" ? "Kalıcı olarak sil" : "Evet, sil"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
