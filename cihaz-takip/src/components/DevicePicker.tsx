"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AVAILABILITY_LABELS, AVAILABILITY_TONES, type Availability } from "@/lib/labels";
import { matchesQuery } from "@/lib/normalize";
import { Badge } from "./ui";

export interface PickerDevice {
  id: string;
  code: string;
  name: string;
  detail: string;
  search: string;
  availability: Availability;
  openFaultId: string | null;
}

/** Arıza bildirirken cihaz seçimi: yazdıkça süzülen liste, büyük dokunma alanları. */
export function DevicePicker({ devices }: { devices: PickerDevice[] }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => devices.filter((d) => matchesQuery(d.search, q)), [devices, q]);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-[15px] font-semibold">Hangi cihaz?</span>
        <input
          className="field"
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Kod, ad, marka, seri no, konum veya kişi yazın"
          aria-label="Cihaz ara"
        />
      </label>
      <p className="text-sm text-muted">{list.length} cihaz</p>
      <ul className="space-y-2">
        {list.slice(0, 100).map((d) => (
          <li key={d.id}>
            <Link
              href={d.openFaultId ? `/arizalar/${d.openFaultId}?mevcut=1` : `/arizalar/yeni?cihaz=${d.id}`}
              className="card flex min-h-16 items-center justify-between gap-3 p-3 hover:border-brand active:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="font-mono text-sm font-bold text-brand">{d.code}</span> <span className="font-semibold">{d.name}</span>
                <span className="block truncate text-sm text-muted">{d.detail}</span>
              </span>
              {d.openFaultId ? (
                <span className="shrink-0 text-right text-sm font-semibold text-amber-800">Açık arıza var →<br />mevcut kayda git</span>
              ) : (
                <Badge tone={AVAILABILITY_TONES[d.availability]}>{AVAILABILITY_LABELS[d.availability]}</Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {list.length > 100 && <p className="text-sm text-muted">İlk 100 sonuç gösteriliyor; aramayı daraltın.</p>}
      {list.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-muted">
          Cihaz bulunamadı. <Link href="/cihazlar/yeni" className="font-semibold text-brand underline">Yeni cihaz ekleyin</Link>
        </div>
      )}
    </div>
  );
}
