import type { Ctx } from "./context";
import type { Queryable } from "./db";

export type Change = { label: string; from: unknown; to: unknown };
export type Changes = Record<string, Change>;

/** İki kayıt arasındaki farkı, yalnızca verilen alanlar için çıkarır (eski → yeni değer). */
export function diff<T extends object>(before: T, after: Partial<T>, labels: Partial<Record<keyof T & string, string>>): Changes {
  const out: Changes = {};
  for (const [field, label] of Object.entries(labels) as [keyof T & string, string][]) {
    if (!(field in after)) continue;
    const a = norm(before[field]);
    const b = norm(after[field]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[field] = { label, from: a, to: b };
  }
  return out;
}

function norm(v: unknown): unknown {
  if (v === undefined || v === "") return null;
  if (Array.isArray(v)) return [...v].sort();
  return v;
}

/**
 * Görünürlük: "finans" satırları (fatura, ödeme, düzeltme, bakiye) yalnızca finans rolüne gösterilir;
 * "genel" satırlar satın alma ve finans rolüne.
 */
export interface AuditEntry {
  entity: string;
  entityId: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  action: string;
  summary: string;
  changes?: Changes | null;
  finance?: boolean;
}

/** Değişiklikle AYNI işlem içinde yazılır: değişiklik geri alınırsa geçmiş satırı da kalmaz. */
export async function audit(q: Queryable, ctx: Ctx, e: AuditEntry): Promise<void> {
  await q.query(
    `insert into audit_log (actor_user_id, actor_label, entity, entity_id, order_id, supplier_id, action, summary, changes, visibility)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ctx.actor.userId, ctx.actor.displayName, e.entity, e.entityId, e.orderId ?? null, e.supplierId ?? null, e.action, e.summary,
      e.changes && Object.keys(e.changes).length ? JSON.stringify(e.changes) : null, e.finance ? "finans" : "genel"],
  );
}

export interface AuditRow {
  id: number;
  at: string;
  actorLabel: string;
  entity: string;
  entityId: string | null;
  orderId: string | null;
  action: string;
  summary: string;
  changes: Changes | null;
  visibility: "genel" | "finans";
}

export const AUDIT_COLS = `id, at, actor_label as "actorLabel", entity, entity_id as "entityId", order_id as "orderId",
  action, summary, changes, visibility`;
