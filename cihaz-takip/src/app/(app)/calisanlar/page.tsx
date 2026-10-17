import type { Metadata } from "next";
import { StaffManager } from "@/components/managers/StaffManager";
import { DownloadLink, PageHeader } from "@/components/ui";
import { formLookups, pageCtx } from "@/server/page";
import { listStaff } from "@/server/services/staff";

export const metadata: Metadata = { title: "Çalışanlar" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const ctx = await pageCtx({ admin: true });
  const [staff, lk] = await Promise.all([listStaff(ctx.db, { includeInactive: true }), formLookups(ctx.db)]);
  return (
    <>
      <PageHeader
        title="Çalışanlar"
        subtitle="Personel kartları cihaz ve arıza kayıtlarında seçilir. Uygulamaya giriş hesabı ayrıdır (Ayarlar → Kullanıcılar); her çalışanın hesabı olması gerekmez."
        actions={<DownloadLink href="/api/disa-aktar/calisanlar" className="btn btn-secondary">Excel</DownloadLink>}
      />
      <StaffManager staff={staff} locations={lk.locations} />
    </>
  );
}
