"use client";

import { useState } from "react";
import { callApi, clearAllDrafts, type ApiError } from "@/components/client";
import { ErrorBanner } from "@/components/form";

/** Genel yönetici: çalışılacak kliniği seçer. Klinik değişince yarım kalmış form taslakları silinir. */
export function ClinicPicker({ clinics, currentId, next }: { clinics: { id: string; name: string; active: boolean }[]; currentId: string | null; next: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div className="space-y-2">
      {clinics.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`btn w-full justify-between ${c.id === currentId ? "btn-primary" : "btn-secondary"}`}
          disabled={busy !== null}
          onClick={async () => {
            setBusy(c.id);
            const r = await callApi("POST", "/api/klinik-sec", { clinicId: c.id });
            if (!r.ok) {
              setErr(r);
              setBusy(null);
              return;
            }
            if (c.id !== currentId) clearAllDrafts();
            window.location.assign(next);
          }}
        >
          <span>{c.name}</span>
          <span className="text-sm font-medium">{c.id === currentId ? "Şu an bu klinikte" : c.active ? "" : "Erişimi kapalı"}</span>
        </button>
      ))}
      <ErrorBanner error={err} />
    </div>
  );
}
