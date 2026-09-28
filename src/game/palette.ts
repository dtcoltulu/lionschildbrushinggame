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
  inner: ["#0F4C5C", "#0A2E3A"],
  chewing: ["#1F5A44", "#123528"],
  gumline: ["#5A2456", "#331433"],
  tutorial: ["#3B2378", "#221248"],
};
