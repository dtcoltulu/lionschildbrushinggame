import { formatDate, formatDateTime } from "@/lib/dates";
import { formatTL } from "@/lib/money";
import type { AuditRow } from "@/server/audit";
import { EmptyState } from "./ui";

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "boş";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "boş";
  if (typeof v === "boolean") return v ? "evet" : "hayır";
  if (typeof v === "number" && field === "costAmount") return formatTL(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return String(v);
}

/** İşlem geçmişi: kim, ne zaman, neyi neyden neye değiştirdi. */
export function History({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <EmptyState>Henüz kayıtlı değişiklik yok.</EmptyState>;
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-slate-200 pl-3">
          <div className="text-sm text-muted">
            {formatDateTime(r.at)} · {r.actorLabel}
          </div>
          <div className="font-medium">{r.summary}</div>
          {r.changes && (
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {Object.entries(r.changes).map(([k, c]) => (
                <li key={k}>
                  <span className="font-semibold">{c.label}:</span> {show(k, c.from)} → {show(k, c.to)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
