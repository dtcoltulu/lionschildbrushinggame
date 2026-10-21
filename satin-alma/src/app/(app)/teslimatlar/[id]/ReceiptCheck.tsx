"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { callApi, type ApiError } from "@/components/client";
import { ErrorBanner, Select, TextArea, TextInput } from "@/components/form";
import { VariantPicker, type PickedVariant } from "@/components/VariantPicker";
import { daysBetween, formatDate } from "@/lib/dates";
import { dec, decimalInput, formatQty, parseDecimalInput } from "@/lib/decimal";
import { ISSUE_TYPES } from "@/lib/labels";

export interface CheckOrderLine {
  id: string;
  lineNo: number;
  variantId: string;
  label: string;
  code: string | null;
  qty: string;
  unitLabel: string;
  packText: string;
  accepted: string;
  held: string;
  pending: string;
  trackExpiry: boolean;
  trackLot: boolean;
  minShelfLifeDays: number | null;
}

export interface CheckLine {
  orderLineId: string | null;
  receivedVariant: PickedVariant | null;
  receivedDesc: string;
  qtyPhysical: string;
  qtyAccepted: string;
  qtyRejected: string;
  qtyHeld: string;
  lotNo: string;
  expiryDate: string;
  chkProduct: boolean;
  chkVariant: boolean;
  chkPackage: boolean;
  issueType: string;
  issueNote: string;
  manual: boolean;
}

const blank = (orderLineId: string | null): CheckLine => ({
  orderLineId, receivedVariant: null, receivedDesc: "", qtyPhysical: "", qtyAccepted: "", qtyRejected: "", qtyHeld: "", lotNo: "", expiryDate: "",
  chkProduct: true, chkVariant: true, chkPackage: true, issueType: "", issueNote: "", manual: false,
});

const n = (s: string) => {
  const v = parseDecimalInput(s, 3);
  return v && v !== "invalid" ? dec(v) : dec(0);
};

/** Sunucudaki kuralların ekrandaki karşılığı (yalnızca yönlendirme içindir; karar sunucuda yeniden denetlenir). */
function evaluate(l: CheckLine, ol: CheckOrderLine | undefined, receivedOn: string) {
  const expired = !!l.expiryDate && l.expiryDate < receivedOn;
  const remaining = l.expiryDate ? daysBetween(receivedOn, l.expiryDate) : null;
  const trackExpiry = l.receivedVariant?.trackExpiry ?? ol?.trackExpiry ?? false;
  const trackLot = l.receivedVariant?.trackLot ?? ol?.trackLot ?? false;
  const shortShelf = !expired && remaining !== null && ol?.minShelfLifeDays != null && remaining < ol.minShelfLifeDays;
  const different = !ol || !l.chkProduct || !l.chkVariant || (!!l.receivedVariant && l.receivedVariant.id !== ol.variantId);
  const reasons: string[] = [];
  let issue = "";
  if (expired) {
    reasons.push(`SKT geçmiş (${formatDate(l.expiryDate)}): kabul edilemez, yalnızca ret.`);
    issue = "skt_gecmis";
  }
  if (!ol) {
    reasons.push("Sipariş dışı ürün: doğrudan kabul edilemez (yönetim incelemesi veya ret).");
    issue ||= "fazla";
  } else if (!l.chkProduct || !l.chkVariant) {
    reasons.push("Ürün/varyant siparişle aynı değil: doğrudan kabul edilemez.");
    issue ||= l.receivedVariant && l.chkProduct ? "farkli_marka" : "yanlis_urun";
  } else if (different) {
    reasons.push("Farklı ürün seçildi: doğrudan kabul edilemez.");
    issue ||= "farkli_marka";
  }
  if (!l.chkPackage) {
    reasons.push("Ambalaj sağlam değil: doğrudan kabul edilemez.");
    issue ||= "hasarli";
  }
  if (trackExpiry && !l.expiryDate) reasons.push("Son kullanma tarihini girin (bu üründe zorunlu).");
  if (trackLot && !l.lotNo) {
    reasons.push("Lot / parti no yok: doğrudan kabul edilemez.");
    issue ||= "lot_eksik";
  }
  if (shortShelf) {
    reasons.push(`Kalan kullanım süresi ${remaining} gün; en az ${ol!.minShelfLifeDays} gün gerekli → yönetim incelemesi.`);
    issue ||= "kisa_miat";
  }
  const acceptable = !expired && !different && l.chkPackage && !(trackLot && !l.lotNo) && !shortShelf && !(trackExpiry && !l.expiryDate);
  return { expired, acceptable, reasons, issue };
}

export function ReceiptCheck(p: {
  receiptId: string;
  version: number;
  receivedOn: string;
  deliveryNoteNo: string | null;
  note: string | null;
  today: string;
  orderLines: CheckOrderLine[];
  initialLines: CheckLine[];
}) {
  const router = useRouter();
  const [receivedOn, setReceivedOn] = useState(p.receivedOn);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState(p.deliveryNoteNo ?? "");
  const [note, setNote] = useState(p.note ?? "");
  const [lines, setLines] = useState<CheckLine[]>(() =>
    p.initialLines.length ? p.initialLines : p.orderLines.filter((l) => dec(l.pending).gt(0)).map((l) => blank(l.id)),
  );
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<"draft" | "post" | null>(null);
  const [saved, setSaved] = useState(false);
  const byId = useMemo(() => new Map(p.orderLines.map((l) => [l.id, l])), [p.orderLines]);

  /** Kullanıcı karar miktarlarını elle değiştirmediyse, gelen miktar ve kontrollerden öneri üretilir. */
  const autoFill = (all: CheckLine[], idx: number): CheckLine[] => {
    const l = all[idx]!;
    if (l.manual) return all;
    const ol = l.orderLineId ? byId.get(l.orderLineId) : undefined;
    const ev = evaluate(l, ol, receivedOn);
    const phys = n(l.qtyPhysical);
    let accepted = dec(0);
    let rejected = dec(0);
    let held = dec(0);
    if (ev.expired) rejected = phys;
    else if (ev.acceptable && ol) {
      const others = all.reduce((a, x, i) => (i !== idx && x.orderLineId === ol.id ? a.plus(n(x.qtyAccepted)) : a), dec(0));
      const room = dec(ol.pending).minus(others);
      accepted = room.lt(phys) ? (room.gt(0) ? room : dec(0)) : phys;
      held = phys.minus(accepted);
    } else held = phys;
    const issue = held.gt(0) && ev.acceptable ? "fazla" : ev.issue;
    const next = [...all];
    next[idx] = { ...l, qtyAccepted: decimalInput(accepted.toFixed(3)), qtyRejected: decimalInput(rejected.toFixed(3)), qtyHeld: decimalInput(held.toFixed(3)), issueType: l.issueType || (rejected.plus(held).gt(0) ? issue : "") };
    return next;
  };
  const update = (idx: number, patch: Partial<CheckLine>, auto = true) =>
    setLines((all) => {
      const next = [...all];
      next[idx] = { ...next[idx]!, ...patch };
      return auto ? autoFill(next, idx) : next;
    });

  const payload = () => ({
    version: p.version,
    receivedOn,
    deliveryNoteNo,
    note,
    lines: lines.filter((l) => l.qtyPhysical.trim() !== "").map((l) => ({
      orderLineId: l.orderLineId, receivedVariantId: l.receivedVariant?.id ?? null, receivedDesc: l.receivedDesc, qtyPhysical: l.qtyPhysical,
      qtyAccepted: l.qtyAccepted || "0", qtyRejected: l.qtyRejected || "0", qtyHeld: l.qtyHeld || "0", lotNo: l.lotNo, expiryDate: l.expiryDate,
      chkProduct: l.chkProduct, chkVariant: l.chkVariant, chkPackage: l.chkPackage, issueType: l.issueType || null, issueNote: l.issueNote,
    })),
  });
  // Sunucu hata anahtarları gönderilen (boş olmayan) satırların sırasına göredir.
  const sentIndex = (idx: number) => lines.slice(0, idx + 1).filter((l) => l.qtyPhysical.trim() !== "").length - 1;
  const fe = (idx: number, field: string) => err?.fieldErrors[`lines.${sentIndex(idx)}.${field}`];

  const submit = async (post: boolean) => {
    if (post) {
      const sent = payload().lines;
      if (!sent.length) return setErr({ ok: false, status: 422, error: "Gelen en az bir ürünün miktarını girin.", fieldErrors: {}, data: {} });
      if (!window.confirm("Kontrol tamamlanınca kabul edilen miktarlar siparişe işlenir ve sorun kayıtları açılır. Bu teslimat daha sonra değiştirilemez (yalnızca gerekçeli iptal). Devam edilsin mi?")) return;
    }
    setBusy(post ? "post" : "draft");
    setErr(null);
    const r = await callApi(post ? "POST" : "PUT", post ? `/api/teslimatlar/${p.receiptId}/tamamla` : `/api/teslimatlar/${p.receiptId}`, payload());
    setBusy(null);
    if (!r.ok) return setErr(r);
    setSaved(!post);
    router.refresh();
  };

  // Kalem özetleri (eksik uyarısı)
  const summaries = p.orderLines.filter((ol) => dec(ol.pending).gt(0) || lines.some((l) => l.orderLineId === ol.id)).map((ol) => {
    const mine = lines.filter((l) => l.orderLineId === ol.id);
    const phys = mine.reduce((a, l) => a.plus(n(l.qtyPhysical)), dec(0));
    const acc = mine.reduce((a, l) => a.plus(n(l.qtyAccepted)), dec(0));
    return { ol, phys, acc, short: dec(ol.pending).minus(phys) };
  });

  return (
    <div className="space-y-5">
      <div className="card grid gap-3 p-4 sm:grid-cols-3">
        <TextInput label="Teslim alma tarihi" type="date" max={p.today} value={receivedOn} onChange={setReceivedOn} error={err?.fieldErrors.receivedOn} />
        <TextInput label="İrsaliye no" value={deliveryNoteNo} onChange={setDeliveryNoteNo} />
        <TextInput label="Teslimat notu" value={note} onChange={setNote} />
      </div>

      {p.orderLines.map((ol) => {
        const idxs = lines.map((l, i) => (l.orderLineId === ol.id ? i : -1)).filter((i) => i >= 0);
        if (!idxs.length && !dec(ol.pending).gt(0)) return null;
        return (
          <section key={ol.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{ol.lineNo}. {ol.label}</h2>
                <p className="text-sm text-muted">{ol.packText}{ol.code ? ` · Kod ${ol.code}` : ""}</p>
                <p className="text-[15px]">
                  Sipariş <b>{formatQty(ol.qty)} {ol.unitLabel}</b> · daha önce kabul {formatQty(ol.accepted)}
                  {dec(ol.held).gt(0) && ` · incelemede ${formatQty(ol.held)}`} · bekleyen <b>{formatQty(ol.pending)}</b>
                </p>
                <p className="text-sm text-slate-700">
                  {[ol.trackExpiry && "SKT zorunlu", ol.trackLot && "Lot no zorunlu", ol.minShelfLifeDays != null && `en az ${ol.minShelfLifeDays} gün raf ömrü`].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            {idxs.length === 0 && <p className="mt-2 text-muted">Bu kalemden ürün gelmediyse boş bırakın.</p>}
            {idxs.map((idx, k) => (
              <LineEditor key={idx} n={k + 1} line={lines[idx]!} ol={ol} receivedOn={receivedOn} fe={(f) => fe(idx, f)}
                onChange={(patch, auto) => update(idx, patch, auto)} onRemove={idxs.length > 1 || lines[idx]!.qtyPhysical === "" ? () => setLines((all) => all.filter((_, i) => i !== idx)) : undefined} />
            ))}
            <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setLines((all) => [...all, blank(ol.id)])}>
              + Bu üründen başka lot / SKT ile gelen
            </button>
          </section>
        );
      })}

      {lines.map((l, idx) => (l.orderLineId === null ? (
        <section key={`x${idx}`} className="card border-violet-300 p-4">
          <h2 className="text-lg font-bold">Sipariş dışı gelen ürün</h2>
          <LineEditor n={1} line={l} ol={undefined} receivedOn={receivedOn} fe={(f) => fe(idx, f)} onChange={(patch, auto) => update(idx, patch, auto)} onRemove={() => setLines((all) => all.filter((_, i) => i !== idx))} />
        </section>
      ) : null))}
      <button type="button" className="btn btn-secondary" onClick={() => setLines((all) => [...all, { ...blank(null), chkProduct: false }])}>+ Sipariş dışı / fazladan ürün geldi</button>

      <div className="card p-4">
        <h2 className="text-lg font-bold">Özet</h2>
        <ul className="mt-2 space-y-1 text-[15px]">
          {summaries.map(({ ol, phys, acc, short }) => (
            <li key={ol.id}>
              {ol.lineNo}. {ol.label}: gelen {formatQty(phys)}, kabul {formatQty(acc)} {ol.unitLabel}
              {short.gt(0) && phys.gt(0) && <span className="font-semibold text-amber-800"> · {formatQty(short)} {ol.unitLabel} eksik → “eksik teslimat” kaydı açılacak, bekleyen miktar açık kalır</span>}
              {phys.isZero() && <span className="text-muted"> · bu teslimatta gelmedi</span>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted">Reddedilen ve incelemeye alınan ürünler kabul edilmiş sayılmaz. Sipariş bu kayıtla tamamlanmaz; yönetim kapatır.</p>
      </div>

      <ErrorBanner error={err} onReload={() => router.refresh()} />
      {saved && <p className="font-semibold text-emerald-800" role="status">✓ Taslak kaydedildi. Başka biri de bu kontrolü açarsa aynı bilgileri görür.</p>}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-xl lg:border">
        <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => submit(false)}>{busy === "draft" ? "Kaydediliyor…" : "Taslağı kaydet"}</button>
        <button type="button" className="btn btn-primary flex-1 sm:flex-none" disabled={busy !== null} onClick={() => submit(true)}>{busy === "post" ? "Kaydediliyor…" : "Kontrolü tamamla ve kaydet"}</button>
      </div>
    </div>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
      <span className="font-medium">{label}</span>
      <span className="flex gap-1">
        <button type="button" role="radio" aria-checked={value} className={`btn btn-sm ${value ? "btn-primary" : "btn-secondary"}`} onClick={() => onChange(true)}>Evet</button>
        <button type="button" role="radio" aria-checked={!value} className={`btn btn-sm ${!value ? "btn-danger-solid" : "btn-secondary"}`} onClick={() => onChange(false)}>Hayır</button>
      </span>
    </div>
  );
}

function LineEditor({ n: no, line: l, ol, receivedOn, fe, onChange, onRemove }: {
  n: number;
  line: CheckLine;
  ol: CheckOrderLine | undefined;
  receivedOn: string;
  fe: (field: string) => string | undefined;
  onChange: (patch: Partial<CheckLine>, auto?: boolean) => void;
  onRemove?: () => void;
}) {
  const ev = evaluate(l, ol, receivedOn);
  const bad = n(l.qtyRejected).plus(n(l.qtyHeld)).gt(0);
  const unit = ol?.unitLabel ?? l.receivedVariant?.orderUnit ?? "adet";
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted">Gelen ürün {no}</span>
        {onRemove && <button type="button" className="text-sm font-semibold text-red-700" onClick={onRemove}>Satırı kaldır</button>}
      </div>
      {ol ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <YesNo label="Doğru ürün mü?" value={l.chkProduct} onChange={(v) => onChange({ chkProduct: v })} />
          <YesNo label="Doğru marka / tip / ölçü mü?" value={l.chkVariant} onChange={(v) => onChange({ chkVariant: v })} />
          <YesNo label="Ambalaj sağlam mı?" value={l.chkPackage} onChange={(v) => onChange({ chkPackage: v })} />
        </div>
      ) : (
        <YesNo label="Ambalaj sağlam mı?" value={l.chkPackage} onChange={(v) => onChange({ chkPackage: v })} />
      )}
      {(!ol || !l.chkProduct || !l.chkVariant) && (
        <div className="space-y-2">
          <VariantPicker label="Gerçekte gelen ürün (katalogdaysa)" value={l.receivedVariant} onChange={(v) => onChange({ receivedVariant: v })} error={fe("receivedVariantId")} />
          {!l.receivedVariant && <TextInput label="Katalogda yoksa gelen ürünü tarif edin" value={l.receivedDesc} onChange={(v) => onChange({ receivedDesc: v }, false)} error={fe("receivedDesc")} />}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <TextInput label={`Gelen miktar (${unit})`} inputMode="decimal" value={l.qtyPhysical} onChange={(v) => onChange({ qtyPhysical: v })} error={fe("qtyPhysical")} />
        <TextInput label={`Son kullanma tarihi${ol?.trackExpiry ? " *" : ""}`} type="date" value={l.expiryDate} onChange={(v) => onChange({ expiryDate: v })} error={fe("expiryDate")} />
        <TextInput label={`Lot / parti no${ol?.trackLot ? " *" : ""}`} value={l.lotNo} onChange={(v) => onChange({ lotNo: v })} error={fe("lotNo")} />
      </div>
      {l.qtyPhysical && ev.reasons.length > 0 && (
        <ul className={`rounded-lg px-3 py-2 text-[15px] ${ev.expired ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-950"}`} role="status">
          {ev.reasons.map((r) => <li key={r}>• {r}</li>)}
        </ul>
      )}
      {l.qtyPhysical && ev.reasons.length === 0 && <p className="text-[15px] font-semibold text-emerald-800">✓ Kontroller uygun: kabul edilebilir.</p>}
      {l.qtyPhysical && (
        <div className="grid grid-cols-3 gap-2">
          <TextInput label="Kabul" inputMode="decimal" value={l.qtyAccepted} onChange={(v) => onChange({ qtyAccepted: v, manual: true }, false)} error={fe("qtyAccepted")} />
          <TextInput label="Ret (iade/değişim)" inputMode="decimal" value={l.qtyRejected} onChange={(v) => onChange({ qtyRejected: v, manual: true }, false)} />
          <TextInput label="Yönetim incelemesi" inputMode="decimal" value={l.qtyHeld} onChange={(v) => onChange({ qtyHeld: v, manual: true }, false)} />
        </div>
      )}
      {bad && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Sorun türü" value={l.issueType} onChange={(v) => onChange({ issueType: v }, false)} emptyLabel="Seçin…" error={fe("issueType")}
            options={ISSUE_TYPES.items.filter((t) => t.value !== "eksik").map((t) => ({ value: t.value, label: t.label }))} />
          <TextArea label="Sorun açıklaması" rows={2} value={l.issueNote} onChange={(v) => onChange({ issueNote: v }, false)} hint="Ne yanlış? (ör. M yerine L beden geldi). Fotoğrafı aşağıdan ekleyin." />
        </div>
      )}
    </div>
  );
}
