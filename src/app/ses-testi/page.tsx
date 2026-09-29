import type { Metadata } from "next";
import { SoundCheck } from "@/components/game/SoundCheck";

export const metadata: Metadata = { title: "Ses testi | Diş Kahramanı" };

export default function SesTestiPage() {
  return <SoundCheck />;
}
