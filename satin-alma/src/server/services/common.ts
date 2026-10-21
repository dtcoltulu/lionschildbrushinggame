import type { Queryable } from "../db";
import { NotFoundError } from "../errors";

/**
 * Klinik içi sıra numarası: "SA-2026-0007". Sayaç satırı işlem içinde kilitlenerek artırılır; eşzamanlı iki
 * işlemde de aynı numara verilmez. İşlem geri alınırsa numara da geri alınır (boşluk oluşmaz).
 */
export async function nextNo(q: Queryable, prefix: string, today: string): Promise<string> {
  const year = Number(today.slice(0, 4));
  const [r] = await q.query<{ value: number }>(
    `insert into counters (name, year, value) values ($1, $2, 1)
     on conflict (clinic_id, name, year) do update set value = counters.value + 1 returning value`,
    [prefix, year],
  );
  return `${prefix}-${year}-${String(r!.value).padStart(4, "0")}`;
}

/** Satırı işlem sonuna kadar kilitler (eşzamanlı değişiklikler sıraya girer). */
export async function lockRow<T>(q: Queryable, table: string, id: string, cols = "*"): Promise<T> {
  const [row] = await q.query<T>(`select ${cols} from ${table} where id = $1 for update`, [id]);
  if (!row) throw new NotFoundError();
  return row;
}

/** Postgres'teki tarih → İstanbul günü ifadesi. */
export const istDate = (col: string) => `(${col} at time zone 'Europe/Istanbul')::date`;
