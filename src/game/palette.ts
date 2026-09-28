export const C = {
  cream: "#FFF7EC",
  tooth: "#FFFDF6",
  toothShade: "#E6DFCF",
  toothLine: "#CFC5AC",
  gum: "#FF8FA3",
  gumDark: "#E0607A",
  lip: "#FF6B6B",
  mouth: "#5A1A2E",
  tongue: "#FF7C93",
  purple: "#2E1A5E",
  purpleMid: "#5B3FA8",
  gold: "#F5B800",
  mint: "#3DDBB0",
  plaque: "198,158,32",
  plaqueDark: "120,90,10",
  germ: "#7BD34A",
  germDark: "#4E9F2A",
} as const;

export const BG: Record<string, [string, string]> = {
  outer: ["#3B2378", "#221248"],
  gaps: ["#5A2456", "#331433"],
  inner: ["#0F4C5C", "#0A2E3A"],
  chewing: ["#1F5A44", "#123528"],
  tongue: ["#6B2A3D", "#3A1424"],
  floss: ["#12507A", "#0A2B44"],
  tutorial: ["#3B2378", "#221248"],
};

/** Sevimli yüzün rengi (arka planın biraz açığı; ten rengi değil, nötr bir "karakter" rengi). */
export const FACE: Record<string, string> = {
  outer: "#5A3FA6",
  gaps: "#86408A",
  inner: "#1B7A8F",
  tongue: "#A24A63",
  floss: "#1C74AD",
};
