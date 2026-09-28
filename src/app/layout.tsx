import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Diş Kahramanı Ol! | 118-Y Lions",
  description: "Çocuklar için eğlenceli ağız ve diş sağlığı oyunu. 118-Y Lions Ağız ve Diş Sağlığı Komitesi.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  applicationName: "Diş Kahramanı",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2e1a5e",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
