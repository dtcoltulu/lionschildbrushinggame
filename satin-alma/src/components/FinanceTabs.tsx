import { Tabs } from "./ui";

export function FinanceTabs({ current }: { current: string }) {
  return (
    <Tabs current={current} items={[
      { key: "ozet", label: "Özet", href: "/finans" },
      { key: "faturalar", label: "Faturalar", href: "/finans/faturalar" },
      { key: "odemeler", label: "Ödemeler", href: "/finans/odemeler" },
      { key: "duzeltmeler", label: "Düzeltmeler", href: "/finans/duzeltmeler" },
    ]} />
  );
}
