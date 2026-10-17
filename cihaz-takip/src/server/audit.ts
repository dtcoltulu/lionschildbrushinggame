import type { Ctx } from "./context";
import type { Queryable } from "./db";

export type Change = { label: string; from: unknown; to: unknown };
export type Changes = Record<string, Change>;

/** İki kayıt arasındaki farkı, yalnızca verilen alanlar için çıkarır. */
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

export interface AuditEntry {
  entity: string;
  entityId: string | null;
  deviceId?: string | null;
  action: string;
  summary: string;
  changes?: Changes | null;
}

/** Değişiklikle AYNI işlem içinde yazılır: değişiklik geri alınırsa geçmiş satırı da kalmaz. */
export async function audit(q: Queryable, ctx: Ctx, e: AuditEntry): Promise<void> {
  await q.query(
    `insert into audit_log (actor_user_id, actor_label, entity, entity_id, device_id, action, summary, changes)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ctx.actor.userId, ctx.actor.displayName, e.entity, e.entityId, e.deviceId ?? null, e.action, e.summary,
      e.changes && Object.keys(e.changes).length ? JSON.stringify(e.changes) : null],
  );
}

export interface AuditRow {
  id: number;
  at: string;
  actorLabel: string;
  entity: string;
  entityId: string | null;
  deviceId: string | null;
  action: string;
  summary: string;
  changes: Changes | null;
}

const AUDIT_COLS = `id, at, actor_label as "actorLabel", entity, entity_id as "entityId", device_id as "deviceId",
  action, summary, changes`;

export async function auditForDevice(q: Queryable, deviceId: string): Promise<AuditRow[]> {
  return q.query<AuditRow>(`select ${AUDIT_COLS} from audit_log where device_id = $1 order by at desc, id desc limit 300`, [deviceId]);
}

export async function auditForEntity(q: Queryable, entity: string, id: string): Promise<AuditRow[]> {
  return q.query<AuditRow>(`select ${AUDIT_COLS} from audit_log where entity = $1 and entity_id = $2 order by at desc, id desc limit 200`, [entity, id]);
}

export async function recentAudit(q: Queryable, opts: { entity?: string; limit?: number } = {}): Promise<AuditRow[]> {
  const params: unknown[] = [];
  let where = "";
  if (opts.entity) {
    params.push(opts.entity);
    where = "where entity = $1";
  }
  params.push(Math.min(opts.limit ?? 200, 1000));
  return q.query<AuditRow>(`select ${AUDIT_COLS} from audit_log ${where} order by at desc, id desc limit $${params.length}`, params);
}
