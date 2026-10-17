import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";

/** Sunucu ve istemci bileşenlerinde kullanılabilen basit görsel parçalar. */

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  orange: "bg-orange-100 text-orange-900 ring-orange-300",
  purple: "bg-violet-50 text-violet-800 ring-violet-200",
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
};

const DOTS: Record<Tone, string> = {
  green: "bg-emerald-600",
  red: "bg-red-600",
  amber: "bg-amber-500",
  orange: "bg-orange-600",
  purple: "bg-violet-600",
  gray: "bg-slate-500",
  blue: "bg-sky-600",
};

/** Durum rozeti: renk tek başına anlam taşımaz, her zaman yazılı etiketle birliktedir. */
export function Badge({ tone, children }: { tone: Tone | string; children: ReactNode }) {
  const t = (tone in TONES ? tone : "gray") as Tone;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ${TONES[t]}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOTS[t]}`} aria-hidden />
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex min-h-10 items-center text-[15px] font-medium text-brand hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight text-ink sm:text-[28px]">{title}</h1>
          {subtitle && <div className="mt-1 text-[15px] text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ children, className = "", title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-bold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = "blue", title, children }: { tone?: "green" | "red" | "amber" | "blue" | "gray"; title?: ReactNode; children?: ReactNode }) {
  const cls = {
    green: "border-emerald-300 bg-emerald-50 text-emerald-900",
    red: "border-red-300 bg-red-50 text-red-900",
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    blue: "border-sky-300 bg-sky-50 text-sky-950",
    gray: "border-slate-300 bg-slate-50 text-slate-800",
  }[tone];
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-[15px] ${cls}`}>
      {title && <div className="font-bold">{title}</div>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-muted">
      <div>{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Tanım listesi satırı (etiket: değer). Boş değerler "—" ile gösterilir; eksik bilgi gizlenmez. */
export function Info({ label, children, missing }: { label: string; children?: ReactNode; missing?: string }) {
  const empty = children === null || children === undefined || children === "" || children === false;
  return (
    <div className="py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[16px] text-ink">{empty ? <span className="text-slate-400">{missing ?? "—"}</span> : children}</dd>
    </div>
  );
}

/** Dosya indirme bağlantısı (sayfa geçişi değil; tarayıcı dosyayı indirir). */
export function DownloadLink({ href, children, className = "btn btn-secondary btn-sm" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={className} download>
      {children}
    </a>
  );
}

export function StatTile({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "red" | "amber" | "orange" }) {
  const accent = tone === "red" ? "text-red-700" : tone === "orange" ? "text-orange-700" : tone === "amber" ? "text-amber-800" : "text-ink";
  const inner = (
    <>
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums ${accent}`}>{value}</div>
      {hint && <div className="mt-1 text-sm text-muted">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition hover:border-brand hover:shadow-sm">
      {inner}
    </Link>
  ) : (
    <div className="card p-4">{inner}</div>
  );
}
