export const nxsTokens = {
  touch: {
    minimum: 48,
  },
  spacing: {
    inlineTight: 4,
    inlineNormal: 8,
    component: 12,
    group: 16,
    section: 24,
    screenCompact: 16,
    screenExpanded: 24,
  },
  radius: {
    control: 10,
    input: 10,
    card: 14,
    sheet: 20,
    expressive: 24,
    pill: 999,
  },
  typography: {
    headline: { fontSize: 26, lineHeight: 34, fontWeight: "800" as const },
    title: { fontSize: 22, lineHeight: 29, fontWeight: "800" as const },
    body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
    bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: "700" as const },
    label: { fontSize: 15, lineHeight: 20, fontWeight: "700" as const },
    caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
  },
  motion: {
    feedbackMs: 100,
    microMs: 160,
    componentMs: 220,
    screenMs: 280,
  },
} as const;

export interface NxsTheme {
  dark: boolean;
  surface: {
    canvas: string;
    section: string;
    raised: string;
    overlay: string;
  };
  text: {
    primary: string;
    secondary: string;
    inverse: string;
  };
  action: {
    primary: string;
    primaryPressed: string;
    secondary: string;
    destructive: string;
  };
  state: {
    info: string;
    success: string;
    warning: string;
    error: string;
    disabled: string;
    loading: string;
  };
  border: {
    subtle: string;
    strong: string;
    warning: string;
    error: string;
  };
  brand: {
    accent: string;
    deep: string;
  };
}

export const nxsLightTheme: NxsTheme = {
  dark: false,
  surface: {
    canvas: "#F6F9FA",
    section: "#FFFFFF",
    raised: "#FFFFFF",
    overlay: "#F2F6F7",
  },
  text: {
    primary: "#0A0D10",
    secondary: "#53636A",
    inverse: "#FFFFFF",
  },
  action: {
    primary: "#19717B",
    primaryPressed: "#0F5A62",
    secondary: "#19717B",
    destructive: "#8F2D2D",
  },
  state: {
    info: "#1B6570",
    success: "#246B4A",
    warning: "#765719",
    error: "#8F2D2D",
    disabled: "#8B969C",
    loading: "#19717B",
  },
  border: {
    subtle: "#DDE5E9",
    strong: "#A9B8BF",
    warning: "#C6A652",
    error: "#D8A0A0",
  },
  brand: {
    accent: "#DFAE2E",
    deep: "#0F5A62",
  },
};

export const nxsDarkTheme: NxsTheme = {
  dark: true,
  surface: {
    canvas: "#0F1518",
    section: "#151E22",
    raised: "#1B262B",
    overlay: "#223036",
  },
  text: {
    primary: "#F4F8F9",
    secondary: "#B9C7CC",
    inverse: "#071012",
  },
  action: {
    primary: "#6EC3CB",
    primaryPressed: "#8FD3DA",
    secondary: "#79CDD5",
    destructive: "#FFAAAA",
  },
  state: {
    info: "#7CCAD2",
    success: "#81D3A8",
    warning: "#E9C86B",
    error: "#FFAAAA",
    disabled: "#7B898F",
    loading: "#79CDD5",
  },
  border: {
    subtle: "#33434A",
    strong: "#61727A",
    warning: "#8E7738",
    error: "#8B5151",
  },
  brand: {
    accent: "#F0C65D",
    deep: "#12363B",
  },
};
