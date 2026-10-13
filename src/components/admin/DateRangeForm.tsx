import Link from "next/link";
import { hasRange, rangeLabel, type DateRange } from "@/lib/range";

/**
 * Tarih aralığı süzgeci (GET formu). Yalnızca görünen sayıları, raporu ve CSV'yi sınırlar; veri silinmez.
 * Etkinlik gününü, ondan önceki deneme oyunlarından ayırmak için kullanılır.
 */
export function DateRangeForm({ action, campaignId, range }: { action: string; campaignId: string; range: DateRange }) {
  const active = hasRange(range);
  const field = "mt-1 min-h-[44px] rounded-lg border border-purple/30 bg-white px-2";
  return (
    <section aria-labelledby="range-title" className="no-print rounded-2xl bg-white p-3 shadow-sm ring-1 ring-purple/10" data-testid="range">
      <h2 id="range-title" className="text-base font-extrabold">
        Tarih aralığı
      </h2>
      <form method="get" action={action} className="mt-2 flex flex-wrap items-end gap-3" data-testid="range-form">
        <input type="hidden" name="k" value={campaignId} />
        <label className="flex flex-col text-sm font-semibold">
          İlk gün
          <input type="date" name="from" defaultValue={range.from ?? ""} className={field} data-testid="range-from" />
        </label>
        <label className="flex flex-col text-sm font-semibold">
          Son gün
          <input type="date" name="to" defaultValue={range.to ?? ""} className={field} data-testid="range-to" />
        </label>
        <button type="submit" className="min-h-[44px] rounded-full bg-purple px-5 font-bold text-white" data-testid="range-apply">
          Uygula
        </button>
        {active && (
          <Link href={`${action}?k=${campaignId}`} className="inline-flex min-h-[44px] items-center px-2 font-semibold underline" data-testid="range-clear">
            Temizle
          </Link>
        )}
      </form>
      <p className="mt-2 text-xs text-ink/60" data-testid="range-note">
        {active ? (
          <>
            Gösterilen dönem: <strong>{rangeLabel(range)}</strong>. Aşağıdaki tüm sayılar, rapor ve CSV yalnızca bu günleri kapsar (günler İstanbul saatine göre); veriler silinmez.
          </>
        ) : (
          "Boş bırakırsanız tüm dönem gösterilir. Aralık, denemeleri etkinlik gününden ayırmak içindir; veriler silinmez."
        )}
      </p>
    </section>
  );
}
