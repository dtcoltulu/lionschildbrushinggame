import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Kayıt bulunamadı" />
      <EmptyState action={<Link href="/" className="btn btn-primary">Genel bakışa dön</Link>}>Aradığınız kayıt yok ya da silinmiş olabilir.</EmptyState>
    </>
  );
}
