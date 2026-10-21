import { formatDateTime } from "@/lib/dates";
import type { AuditRow } from "@/server/audit";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Evet" : "Hayır") : Array.isArray(v) ? v.join(", ") : String(v));

/** İşlem geçmişi: kim, ne zaman, neyi neyden neye değiştirdi. */
export function History({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="text-muted">Kayıt yok.</p>;
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-slate-200 pl-3">
          <div className="text-sm text-muted">
            {formatDateTime(r.at)} · <span className="font-semibold text-slate-700">{r.actorLabel}</span>
          </div>
          <div className="text-[15px]">{r.summary}</div>
          {r.changes && (
            <ul className="mt-1 text-sm text-slate-600">
              {Object.values(r.changes).map((c, i) => (
                <li key={i}>
                  {c.label}: <span className="line-through decoration-slate-400">{show(c.from)}</span> → <span className="font-semibold">{show(c.to)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
