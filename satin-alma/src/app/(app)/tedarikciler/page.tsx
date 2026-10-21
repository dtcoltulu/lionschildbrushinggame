import Link from "next/link";
import { Badge, DataTable, PageHeader } from "@/components/ui";
import { formatMoney } from "@/lib/decimal";
import { firstParam, pageCtx, type SearchParams } from "@/server/page";
import { can } from "@/server/permissions";
import { supplierBalances } from "@/server/services/balances";
import { listSuppliers } from "@/server/services/suppliers";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await pageCtx("supplier.view");
  const sp = await searchParams;
  const all = firstParam(sp.pasif) === "1";
  const rows = await listSuppliers(ctx, { includeInactive: all });
  const finance = can(ctx.actor, "finance.view");
  const balances = finance ? await supplierBalances(ctx) : [];
  return (
    <>
      <PageHeader title="Tedarikçiler" actions={
        <>
          {can(ctx.actor, "supplier.manage") && <Link className="btn btn-primary" href="/tedarikciler/yeni">+ Tedarikçi</Link>}
          <Link className="btn btn-secondary" href={all ? "/tedarikciler" : "/tedarikciler?pasif=1"}>{all ? "Yalnızca aktifler" : "Pasifler de"}</Link>
        </>
      } />
      <DataTable
        rows={rows}
        rowKey={(s) => s.id}
        empty="Tedarikçi yok."
        columns={[
          { label: "Firma / depo", cell: (s) => <><Link className="font-semibold text-brand hover:underline" href={`/tedarikciler/${s.id}`}>{s.name}</Link>{!s.active && <> <Badge tone="gray">Pasif</Badge></>}</> },
          { label: "İlgili kişi", cell: (s) => s.contactName ?? "—" },
          { label: "Telefon", cell: (s) => s.phone ?? "—" },
          { label: "Ödeme koşulu / vade", cell: (s) => [s.paymentTerms, s.dueDays != null && `${s.dueDays} gün`].filter(Boolean).join(" · ") || "—" },
          { label: "Para birimi", cell: (s) => s.currency },
          ...(finance ? [{ label: "Bakiye (borç)", align: "right" as const, cell: (s: (typeof rows)[number]) => balances.filter((b) => b.supplierId === s.id).map((b) => formatMoney(b.balance, b.currency)).join(" · ") || "—" }] : []),
        ]}
      />
    </>
  );
}
