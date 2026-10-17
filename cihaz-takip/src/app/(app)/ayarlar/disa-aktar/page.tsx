import type { Metadata } from "next";
import { SettingsTabs } from "@/components/SettingsTabs";
import { Card, DownloadLink, PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";
import { EXPORTS } from "@/server/services/export";

export const metadata: Metadata = { title: "Dışa aktarım ve yedek" };
export const dynamic = "force-dynamic";

export default async function ExportPage() {
  await pageCtx({ admin: true });
  return (
    <>
      <PageHeader title="Ayarlar" />
      <SettingsTabs current="/ayarlar/disa-aktar" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Excel’e aktar">
          <p className="mb-3 text-[15px] text-muted">Dosyalar Türkçe Excel’de çift tıklayınca doğru açılır (UTF-8, noktalı virgül). Silinen kayıtlar dahil edilmez.</p>
          <ul className="space-y-2">
            {Object.entries(EXPORTS).map(([k, label]) => (
              <li key={k}>
                <DownloadLink className="btn btn-secondary w-full justify-between" href={`/api/disa-aktar/${k}`}>
                  <span>{label}</span>
                  <span aria-hidden>⬇</span>
                </DownloadLink>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Yedekleme">
          <div className="space-y-2 text-[15px]">
            <p>Asıl yedek veritabanı düzeyindedir (bkz. kurulum belgesi, “Yedekleme ve geri yükleme”):</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Haftada bir <code>pg_dump</code> ile tam yedek alınır ve klinik dışında güvenli bir yerde saklanır.</li>
              <li>Geri yükleme, yedek dosyasının yeni/boş bir veritabanına yüklenmesiyle yapılır; önce test ortamında denenir.</li>
              <li>Buradaki Excel dosyaları insan tarafından okunabilir ek arşivdir; tek başına geri yükleme için yeterli değildir.</li>
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
