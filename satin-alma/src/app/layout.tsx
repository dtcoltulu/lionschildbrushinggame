import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Satın Alma | Koşuyolu Park", template: "%s | Satın Alma" },
  description: "Özel Koşuyolu Park Ağız ve Diş Sağlığı Polikliniği – sarf malzemesi talep, satın alma, teslimat kontrolü ve tedarikçi borç takibi",
  robots: { index: false, follow: false },
  applicationName: "Satın Alma",
  appleWebApp: { capable: true, title: "Satın Alma", statusBarStyle: "default" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0f6e6a" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
