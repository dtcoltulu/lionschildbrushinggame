import type { MetadataRoute } from "next";

/** Telefonda "Ana ekrana ekle" ile uygulama gibi açılır. Veriler her zaman sunucudan gelir (çevrimdışı önbellek yok). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Koşuyolu Park Cihaz Takip",
    short_name: "Cihaz Takip",
    description: "Cihaz envanteri, arıza ve teknik servis takibi",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#0f6e6a",
    lang: "tr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
