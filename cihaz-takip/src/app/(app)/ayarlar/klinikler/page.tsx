import type { Metadata } from "next";
import { ClinicManager } from "@/components/managers/ClinicManager";
import { SettingsTabs } from "@/components/SettingsTabs";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/server/db";
import { getLoginAdmin } from "@/server/login-admin";
import { pageCtx } from "@/server/page";
import { listClinics } from "@/server/services/clinics";

export const metadata: Metadata = { title: "Klinikler" };
export const dynamic = "force-dynamic";

/** Yalnızca genel yönetici: klinik ekleme, ad/erişim, klinik şifreleri. */
export default async function ClinicsPage() {
  const ctx = await pageCtx({ superAdmin: true });
  const logins = getLoginAdmin();
  const clinics = await listClinics(await getDb(), logins);
  return (
    <>
      <PageHeader title="Ayarlar" subtitle="Her kliniğin verisi ayrıdır; bir klinik diğerinin cihazlarını, arızalarını ve çalışanlarını göremez." />
      <SettingsTabs current="/ayarlar/klinikler" superAdmin />
      <ClinicManager clinics={clinics} mode={logins.mode} currentId={ctx.actor.clinicId} />
    </>
  );
}
