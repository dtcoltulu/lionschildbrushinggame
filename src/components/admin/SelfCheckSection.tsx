import { tr } from "@/content/tr";
import { formatPercent, type SelfCheckStats } from "@/lib/kpi";

/**
 * "Sence yeterli ve etkin temizlendi mi?" cevapları. Soru her aşama bittikten sonra (sahne tamamen temizken, ama diğer
 * yüzeyler henüz kalmışken) sorulur: "Evet" = çocuk işi erken bırakmak istedi, "Hayır" = doğru farkındalık.
 */
export function SelfCheckSection({ c, printable = false }: { c: SelfCheckStats; printable?: boolean }) {
  return (
    <section
      aria-labelledby="selfcheck"
      className={printable ? "mt-6" : "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-purple/10"}
      data-testid="selfcheck"
    >
      <h2 id="selfcheck" className="text-xl font-extrabold">
        “{tr.check.question}” cevapları
      </h2>
      <p className="mt-1 text-sm text-ink/70">
        Soru her aşama bittikten sonra, diğer yüzeyler henüz kalmışken sorulur (son aşamada sorulmaz). <strong>Evet</strong> = çocuk işi erken bırakmak istedi,{" "}
        <strong>Hayır</strong> = doğru farkındalık. Oranlar cevap sayısı üzerindendir; bir çocuk birden çok kez cevaplar.
      </p>

      {c.total === 0 ? (
        <p className="mt-3 text-sm" data-testid="selfcheck-empty">
          Henüz cevap yok.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat testId="selfcheck-yes" label="Evet" value={String(c.yes)} sub={formatPercent(c.yesRate)} testRate="selfcheck-yes-rate" />
            <Stat testId="selfcheck-no" label="Hayır" value={String(c.no)} sub={formatPercent(c.noRate)} testRate="selfcheck-no-rate" />
            <Stat testId="selfcheck-total" label="Toplam cevap" value={String(c.total)} sub={`${c.children} çocuk (tarayıcı)`} />
            <Stat
              testId="selfcheck-children-yes"
              label="En az bir kez “Evet” diyen"
              value={String(c.childrenYes)}
              sub={`cevaplayanların ${formatPercent(c.children > 0 ? c.childrenYes / c.children : null)}`}
            />
          </dl>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="selfcheck-phases">
              <caption className="sr-only">Aşama bazlı cevaplar</caption>
              <thead>
                <tr className="border-b border-purple/20 text-left">
                  <th scope="col" className="py-2 pr-2">Aşama</th>
                  <th scope="col" className="px-2 text-right">Evet</th>
                  <th scope="col" className="px-2 text-right">Hayır</th>
                  <th scope="col" className="px-2 text-right">Toplam</th>
                  <th scope="col" className="pl-2">Evet oranı</th>
                </tr>
              </thead>
              <tbody>
                {c.byPhase.map((p) => (
                  <tr key={p.phase} className="border-b border-purple/10">
                    <th scope="row" className="py-1.5 pr-2 text-left font-semibold">
                      {p.phase}. {tr.phases[p.phase - 1]?.name ?? ""}
                    </th>
                    <td className="px-2 text-right tabular-nums">{p.yes}</td>
                    <td className="px-2 text-right tabular-nums">{p.no}</td>
                    <td className="px-2 text-right tabular-nums">{p.total}</td>
                    <td className="pl-2">
                      <div className="flex items-center gap-2">
                        <div className="hidden h-3 w-24 overflow-hidden rounded-full bg-purple-soft sm:block" aria-hidden="true">
                          <div className="h-full rounded-full bg-coral" style={{ width: `${Math.round((p.yesRate ?? 0) * 100)}%` }} />
                        </div>
                        <span className="tabular-nums">{formatPercent(p.yesRate)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub, testId, testRate }: { label: string; value: string; sub?: string; testId: string; testRate?: string }) {
  return (
    <div className="rounded-xl bg-purple-soft/60 p-3">
      <dt className="text-sm font-semibold text-ink/70">{label}</dt>
      <dd className="mt-1 text-3xl font-black tabular-nums text-purple" data-testid={testId}>
        {value}
      </dd>
      {sub && (
        <dd className="text-sm font-bold text-ink/70" data-testid={testRate}>
          {sub}
        </dd>
      )}
    </div>
  );
}
