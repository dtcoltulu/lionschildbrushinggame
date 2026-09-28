import Link from "next/link";
import { tr } from "@/content/tr";

export default function GizlilikPage() {
  return (
    <main className="screen mx-auto flex max-w-xl flex-col gap-4 px-5 py-6">
      <h1 className="text-3xl font-black text-purple">{tr.privacyPage.title}</h1>
      {tr.privacyPage.body.map((p) => (
        <p key={p} className="text-lg leading-relaxed">
          {p}
        </p>
      ))}
      <Link href="/oyun" className="btn-big btn-gold mt-2 inline-flex items-center justify-center self-start text-xl">
        {tr.privacyPage.back}
      </Link>
    </main>
  );
}
