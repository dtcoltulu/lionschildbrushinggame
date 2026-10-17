import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DENTINEL | Koşuyolu Park", template: "%s | DENTINEL" },
  description: "DENTINEL – Özel Koşuyolu Park Ağız ve Diş Sağlığı Polikliniği cihaz envanteri, arıza ve teknik servis takibi",
  robots: { index: false, follow: false },
  applicationName: "DENTINEL",
  appleWebApp: { capable: true, title: "DENTINEL", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f6e6a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
