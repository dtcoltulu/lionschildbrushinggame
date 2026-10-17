"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { daysBetween, formatDate } from "@/lib/dates";
import { FAULT_STATUSES, OUTCOMES, VERIFICATIONS, type FaultStatus } from "@/lib/labels";
import { EMPTY_VISIT, faultToForm, type FaultFormValues, type VisitValues } from "@/lib/fault-form";
import { parseMoney, formatTL } from "@/lib/money";
import type { FormLookups, Opt } from "@/server/page";
import type { FaultDetail } from "@/server/services/faults";
import { callApi, useDraft, type ApiError } from "../client";
import { Details, DraftBanner, ErrorBanner, FieldShell, SaveBar, Segmented, Select, TextArea, TextInput } from "../form";
import { Notice } from "../ui";

/** Hangi gidiş düzenleniyor: yeni bir tamire gidiş mi, yoksa mevcut gidiş mi? (Sunucudaki kuralın aynısı.) */
function opensNewVisit(server: FaultStatus | null, target: FaultStatus, resend: string): boolean {
  if (target !== "serviste" && target !== "tamirden_geldi") return false;
  if (server === null || server === "arizali" || server === "cozuldu") return true;
  return server === "tamirden_geldi" && target === "serviste" && resend === "yes";
}

export function FaultForm(props: {
  mode: "create" | "edit";
  faultId?: string;
  version?: number;
  serverStatus?: FaultStatus;
  device: { id: string; code: string; name: string };
  initial: FaultFormValues;
  lookups: FormLookups;
  canAssignResponsibility: boolean;
  today: string;
}) {
  const { mode, faultId, device, lookups, today } = props;
  const router = useRouter();
  const draft = useDraft<FaultFormValues>(mode === "create" ? `ariza:yeni:${device.id}` : `ariza:${faultId}`, props.initial);
  const v = draft.value;
  const [version, setVersion] = useState(props.version ?? 1);
  const [serverStatus, setServerStatus] = useState<FaultStatus | null>(props.serverStatus ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Opt[]>(lookups.vendors);
  const [newVendor, setNewVendor] = useState("");
  const [vendorMsg, setVendorMsg] = useState<string | null>(null);
  const fe = err?.fieldErrors ?? {};

  const set = <K extends keyof FaultFormValues>(k: K, val: FaultFormValues[K]) => draft.setValue((p) => ({ ...p, [k]: val }));
  const isNew = opensNewVisit(serverStatus, v.status, v.resend);
  const visitKey = isNew ? "newVisit" : "visit";
  const visit = v[visitKey];
  const setVisit = <K extends keyof VisitValues>(k: K, val: VisitValues[K]) => draft.setValue((p) => ({ ...p, [visitKey]: { ...p[visitKey], [k]: val } }));
  const showService = v.status === "serviste" || v.status === "tamirden_geldi";
  const showReturn = v.status === "tamirden_geldi";

  async function addVendor() {
    const name = newVendor.trim();
    if (!name) return;
    const r = await callApi<{ item: { id: string; name: string } }>("POST", "/api/listeler/service_vendors", { name });
    if (r.ok) {
      setVendors((list) => [...list, { value: r.data.item.id, label: r.data.item.name }]);
      setVisit("vendorId", r.data.item.id);
      setNewVendor("");
      setVendorMsg(`“${r.data.item.name}” eklendi ve seçildi.`);
    } else setVendorMsg(r.fieldErrors.name ?? r.error);
  }

  async function save(overrideVersion?: number) {
    setBusy(true);
    setErr(null);
    setSavedAt(null);
    const body: Record<string, unknown> = {
      description: v.description, noticedOn: v.noticedOn, noticedByStaffId: v.noticedByStaffId, lastUserStaffId: v.lastUserStaffId,
      locationId: v.locationId, causeId: v.causeId, causeDetail: v.causeDetail, causeVerification: v.causeVerification,
      status: v.status, resolutionNote: v.resolutionNote,
      visit: showService ? { ...visit, outcome: showReturn ? visit.outcome : "" } : {},
    };
    if (props.canAssignResponsibility) {
      Object.assign(body, {
        responsibleStaffId: v.responsibleStaffId, responsibilityEvidence: v.responsibilityEvidence, responsibilityVerifiedByStaffId: v.responsibilityVerifiedByStaffId,
      });
    }
    if (serverStatus === "tamirden_geldi" && v.status === "serviste") body.resend = v.resend === "" ? null : v.resend === "yes";
    let r;
    if (mode === "create") r = await callApi<{ fault: FaultDetail }>("POST", "/api/arizalar", { ...body, deviceId: device.id });
    else r = await callApi<{ fault: FaultDetail }>("PATCH", `/api/arizalar/${faultId}`, { ...body, version: overrideVersion ?? version });
    setBusy(false);
    if (!r.ok) {
      setErr(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const f = r.data.fault;
    draft.clear();
    if (mode === "create") {
      router.push(`/arizalar/${f.id}?kaydedildi=yeni`);
      router.refresh();
      return;
    }
    draft.reset(faultToForm(f));
    setVersion(f.version);
    setServerStatus(f.status);
    setSavedAt(new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }));
    router.refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const overdue = serverStatus === "serviste" && v.visit.expectedReturnOn && v.visit.expectedReturnOn < today;
  const statusOptions = FAULT_STATUSES.map((s) => ({
    value: s.value,
    label: s.label,
    hint: {
      arizali: "Cihaz kullanılamıyor, henüz servise gitmedi",
      serviste: "Teknik servise gönderildi",
      tamirden_geldi: "Servisten döndü (sonucu aşağıda seçin)",
      cozuldu: "Klinikte giderildi ya da yanlış alarm",
    }[s.value],
  }));
  const costPreview = parseMoney(visit.costAmount);

  const serviceBlock = (
          <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <h3 className="font-bold">{isNew ? "Servis bilgileri (yeni gidiş)" : "Servis bilgileri"}</h3>
            <p className="text-sm text-muted">Bilinmeyen alanları boş bırakın; sonra tamamlanabilir.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Select label="Servis firması / teknik servis" value={visit.vendorId} onChange={(x) => setVisit("vendorId", x)} options={vendors} emptyLabel="Bilinmiyor / seçilmedi" error={fe["visit.vendorId"]} />
                <Details summary="Listede yok mu? Yeni firma ekle">
                  <div className="flex gap-2">
                    <input className="field" value={newVendor} onChange={(e) => setNewVendor(e.target.value)} placeholder="Firma adı" aria-label="Yeni firma adı" />
                    <button type="button" className="btn btn-secondary" onClick={() => void addVendor()}>Ekle</button>
                  </div>
                  {vendorMsg && <p className="text-sm">{vendorMsg}</p>}
                </Details>
              </div>
              <DateWithToday label="Gönderim tarihi" value={visit.sentOn} onChange={(x) => setVisit("sentOn", x)} error={fe["visit.sentOn"]} today={today} max={today} />
              <TextInput label="Beklenen dönüş tarihi" type="date" value={visit.expectedReturnOn} onChange={(x) => setVisit("expectedReturnOn", x)} error={fe["visit.expectedReturnOn"]} hint="İleri bir tarih olabilir. Geçince “Gecikti” görünür." />
              <TextArea label="Servis notu" value={visit.serviceNote} onChange={(x) => setVisit("serviceNote", x)} error={fe["visit.serviceNote"]} rows={2} />
            </div>
          </div>
  );

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {savedAt && <Notice tone="green" title={`Kaydedildi ✓ (${savedAt})`}>Tüm değişiklikler sunucuya kaydedildi.</Notice>}
      <DraftBanner restored={draft.restored} onDiscard={draft.discard} />
      <ErrorBanner
        error={err}
        onReload={() => {
          draft.discard();
          window.location.reload();
        }}
        onOverwrite={() => {
          const cur = (err?.data.current as { version?: number } | undefined)?.version;
          if (cur) {
            setVersion(cur);
            void save(cur);
          }
        }}
      />
      {err?.code === "open_fault_exists" && typeof err.data.faultId === "string" && (
        <Link href={`/arizalar/${err.data.faultId}`} className="btn btn-primary w-full">Mevcut arıza kaydına git</Link>
      )}

      <div className="card space-y-4 p-4">
        <TextArea label="Ne oldu?" required value={v.description} onChange={(x) => set("description", x)} error={fe.description} placeholder="Örn. Aeratör dönerken ses yapıyor, su gelmiyor" rows={3} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Arızanın fark edildiği tarih" type="date" max={today} value={v.noticedOn} onChange={(x) => set("noticedOn", x)} error={fe.noticedOn} required />
          <Select label="Arızayı fark eden çalışan" value={v.noticedByStaffId} onChange={(x) => set("noticedByStaffId", x)} options={lookups.staff} emptyLabel="Belirtilmedi" error={fe.noticedByStaffId} hint="Fark eden kişi arızadan sorumlu sayılmaz." />
        </div>
      </div>

      <div className="card space-y-4 p-4">
        <Segmented name="status" label="Durum" value={v.status} onChange={(x) => set("status", x)} options={statusOptions} error={fe.status} />
        {overdue && (
          <Notice tone="amber">Beklenen dönüş tarihi geçti ({daysBetween(v.visit.expectedReturnOn, today)} gün). Kayıt yine de güncellenebilir.</Notice>
        )}
        {serverStatus === "serviste" && v.status === "arizali" && (
          <Notice tone="blue">Kaydedince servise gönderim geri alınır; bu gidiş tamire gidiş sayısına girmez.</Notice>
        )}
        {serverStatus === "tamirden_geldi" && v.status === "serviste" && (
          <Segmented
            name="resend"
            label="Ne oldu?"
            value={v.resend}
            onChange={(x) => draft.setValue((p) => ({ ...p, resend: x, newVisit: EMPTY_VISIT }))}
            error={fe.resend}
            options={[
              { value: "yes", label: "Tekrar servise gönderildi", hint: "Yeni bir tamire gidiş sayılır" },
              { value: "no", label: "“Tamirden geldi” yanlışlıkla seçilmişti", hint: "Geri alınır, yeni gidiş sayılmaz" },
            ]}
          />
        )}
        {v.status === "cozuldu" && (
          <TextArea label="Ne yapıldı? (isteğe bağlı)" value={v.resolutionNote} onChange={(x) => set("resolutionNote", x)} error={fe.resolutionNote} placeholder="Örn. Klinikte yağlandı, sorun giderildi" />
        )}

        {showReturn && (
          <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
            <h3 className="font-bold">Dönüş bilgileri</h3>
            <Segmented
              name="outcome"
              label="Sonuç: cihaz kullanıma hazır mı?"
              value={visit.outcome}
              onChange={(x) => setVisit("outcome", x)}
              error={fe["visit.outcome"]}
              options={OUTCOMES.map((o) => ({
                value: o.value,
                label: o.label,
                hint: o.value === "kullanima_hazir" ? "Arıza kapanır, cihaz kullanılabilir olur" : "Cihaz kullanılamaz görünmeye devam eder",
              }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <DateWithToday label="Gerçek dönüş tarihi" value={visit.returnedOn} onChange={(x) => setVisit("returnedOn", x)} error={fe["visit.returnedOn"]} today={today} max={today} hint="Bilinmiyorsa boş bırakın; servis süresi “hesaplanamadı” görünür." />
              <TextArea label="Yapılan işlem" value={visit.workDone} onChange={(x) => setVisit("workDone", x)} error={fe["visit.workDone"]} rows={2} />
              <TextInput
                label="Tamir maliyeti (TL)"
                inputMode="decimal"
                value={visit.costAmount}
                onChange={(x) => setVisit("costAmount", x)}
                error={fe["visit.costAmount"]}
                placeholder="Örn. 1.250,00"
                hint={
                  visit.costAmount.trim() === ""
                    ? "Boş = tutar bilinmiyor. Ücretsiz tamir için 0 yazın."
                    : costPreview === 0
                      ? "Ücretsiz tamir (0 TL) olarak kaydedilecek."
                      : typeof costPreview === "number"
                        ? `${formatTL(costPreview)} olarak kaydedilecek.`
                        : "Geçerli bir tutar yazın. Örn. 1.250,50"
                }
              />
              <div className="space-y-2">
                <TextInput label="Masraf tarihi" type="date" max={today} value={visit.costDate} onChange={(x) => setVisit("costDate", x)} error={fe["visit.costDate"]} hint="Maliyet bu tarihin ayına yazılır. Bilinmiyorsa boş bırakın (“tarihi eksik” görünür)." />
                {visit.returnedOn && visit.costDate !== visit.returnedOn && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setVisit("costDate", visit.returnedOn)}>
                    Dönüş tarihiyle aynı ({formatDate(visit.returnedOn)})
                  </button>
                )}
              </div>
              <TextInput label="Servis raporu / fiş referansı" value={visit.receiptRef} onChange={(x) => setVisit("receiptRef", x)} error={fe["visit.receiptRef"]} placeholder="Örn. fatura no" />
            </div>
          </div>
        )}
        {v.status === "serviste" && serviceBlock}
        {showReturn && (
          <Details
            summary="Servis gönderim bilgileri (firma, tarihler, not)"
            defaultOpen={isNew || ["visit.vendorId", "visit.sentOn", "visit.expectedReturnOn", "visit.serviceNote"].some((k) => fe[k])}
          >
            {serviceBlock}
          </Details>
        )}
      </div>

      <Details summary="Ayrıntılar: son kullanıcı, konum, arıza nedeni" defaultOpen={mode === "edit"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Son bilinen kullanıcı" value={v.lastUserStaffId} onChange={(x) => set("lastUserStaffId", x)} options={lookups.staff} emptyLabel="Bilinmiyor" error={fe.lastUserStaffId} hint="Son kullanan kişi arızadan sorumlu sayılmaz." />
          <Select label="Arıza anındaki oda / ünit" value={v.locationId} onChange={(x) => set("locationId", x)} options={lookups.locations} emptyLabel="Belirtilmedi" error={fe.locationId} />
          <Select label="Arıza nedeni" value={v.causeId} onChange={(x) => set("causeId", x)} options={lookups.causes} error={fe.causeId} hint="Bilinmiyorsa “Belirlenmedi” kalsın; tahmin etmeniz gerekmez." />
          <Select label="Neden doğrulama durumu" value={v.causeVerification} onChange={(x) => set("causeVerification", x)} options={VERIFICATIONS.map((x) => ({ value: x.value, label: x.label }))} error={fe.causeVerification} />
          <div className="sm:col-span-2">
            <TextInput label="Neden açıklaması" value={v.causeDetail} onChange={(x) => set("causeDetail", x)} error={fe.causeDetail} placeholder="Örn. servis raporuna göre rulman aşınmış" />
          </div>
        </div>
      </Details>

      {props.canAssignResponsibility && (
        <Details summary="Sorumluluk ataması (yalnızca doğrulanmışsa)" defaultOpen={!!props.initial.responsibleStaffId}>
          <Notice tone="gray">
            Arızayı fark eden veya cihazı son kullanan kişi sorumlu değildir. Bu bölümü yalnızca arızaya neden olan kişi bir tespitle doğrulandıysa doldurun.
          </Notice>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Arızaya neden olduğu doğrulanan kişi" value={v.responsibleStaffId} onChange={(x) => set("responsibleStaffId", x)} options={lookups.staff} emptyLabel="Atama yok" error={fe.responsibleStaffId} />
            <Select label="Doğrulayan kişi" value={v.responsibilityVerifiedByStaffId} onChange={(x) => set("responsibilityVerifiedByStaffId", x)} options={lookups.staff} emptyLabel="Seçin…" error={fe.responsibilityVerifiedByStaffId} />
            <div className="sm:col-span-2">
              <TextArea label="Tespit / kanıt açıklaması" value={v.responsibilityEvidence} onChange={(x) => set("responsibilityEvidence", x)} error={fe.responsibilityEvidence} placeholder="Neye dayanarak? Örn. servis raporu, kamera kaydı, kişinin beyanı" />
            </div>
          </div>
        </Details>
      )}

      <SaveBar busy={busy} label={mode === "create" ? "Arızayı kaydet" : "Kaydet"} />
    </form>
  );
}

function DateWithToday({ label, value, onChange, error, today, max, hint }: { label: string; value: string; onChange: (v: string) => void; error?: string; today: string; max?: string; hint?: string }) {
  return (
    <FieldShell label={label} error={error} hint={hint}>
      <div className="flex gap-2">
        <input type="date" className="field" value={value} max={max} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-label={label} />
        {value !== today && (
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => onChange(today)}>
            Bugün
          </button>
        )}
      </div>
    </FieldShell>
  );
}
