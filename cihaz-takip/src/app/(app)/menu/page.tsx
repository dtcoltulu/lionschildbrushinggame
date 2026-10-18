import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { pageCtx } from "@/server/page";

export const metadata: Metadata = { title: "Menü" };
export const dynamic = "force-dynamic";

/** Telefondaki alt menünün "Diğer" sayfası. */
export default async function MenuPage() {
  const ctx = await pageCtx();
  const links = [
    ...(ctx.actor.role === "admin"
      ? [
          { href: "/analizler", label: "Analizler", hint: "Sık tamire giden cihazlar, aylık maliyet, arıza nedenleri" },
          { href: "/calisanlar", label: "Çalışanlar", hint: "Personel kartları" },
          { href: "/ayarlar", label: "Giriş ve erişim", hint: "Klinik şifreleri ve kişisel hesaplar" },
          { href: "/ayarlar/listeler", label: "Listeler", hint: "Konumlar, cihaz türleri, arıza nedenleri, servis firmaları" },
          { href: "/arizalar?gorunum=silinen", label: "Silinen kayıtlar", hint: "Geri alma" },
          { href: "/ayarlar/disa-aktar", label: "Excel'e aktar", hint: "Dışa aktarım ve yedek" },
        ]
      : []),
    ...(ctx.actor.superAdmin
      ? [
          { href: "/ayarlar/klinikler", label: "Klinikler", hint: "Klinik ekle, şifreleri belirle" },
          { href: "/klinik-sec?next=%2Fmenu", label: "Klinik değiştir", hint: `Şu an: ${ctx.actor.clinicName}` },
        ]
      : []),
    { href: "/hesabim", label: "Hesabım", hint: ctx.actor.displayName },
  ];
  return (
    <>
      <PageHeader title="Menü" />
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="card block p-4 hover:border-brand">
              <div className="text-[17px] font-semibold">{l.label}</div>
              <div className="text-sm text-muted">{l.hint}</div>
            </Link>
          </li>
        ))}
      </ul>
      <form action="/api/cikis" method="post" className="mt-4">
        <button className="btn btn-secondary w-full">Çıkış yap</button>
      </form>
    </>
  );
}
