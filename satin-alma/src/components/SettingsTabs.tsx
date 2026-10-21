import { Tabs } from "./ui";

export function SettingsTabs({ current, items }: { current: string; items: { key: string; label: string; href: string }[] }) {
  return <Tabs current={current} items={items} />;
}
