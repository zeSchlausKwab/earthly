import React from "react";

/**
 * Badge — a tiny status/type marker. `tone` picks the color; `solid` fills (use for
 * LIVE), otherwise a translucent tint. Type chips (Poly/Line/Point) are badges too.
 */
const TONES = {
  neutral: { fg: "var(--text-muted)", bd: "var(--border-strong)", bg: "transparent", solidBg: "var(--n-line)", solidFg: "var(--n-text-hi)" },
  amber: { fg: "var(--accent-active-text)", bd: "transparent", bg: "var(--fill-active-14)", solidBg: "var(--accent-active)", solidFg: "var(--accent-ink)" },
  cyan: { fg: "var(--accent-info-text)", bd: "transparent", bg: "color-mix(in oklch, var(--accent-info) 22%, transparent)", solidBg: "var(--accent-info)", solidFg: "#08222c" },
  green: { fg: "var(--accent-ok-text)", bd: "transparent", bg: "color-mix(in oklch, var(--accent-ok) 20%, transparent)", solidBg: "var(--accent-ok)", solidFg: "#08160d" },
  red: { fg: "var(--accent-danger)", bd: "transparent", bg: "color-mix(in oklch, var(--accent-danger) 20%, transparent)", solidBg: "var(--accent-danger)", solidFg: "#2a0c07" },
  violet: { fg: "var(--accent-edit-text)", bd: "transparent", bg: "var(--fill-edit-14)", solidBg: "var(--accent-edit)", solidFg: "#fff" },
};
export function Badge({ tone = "neutral", solid = false, mono = false, children, style }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 16,
        padding: "0 6px",
        borderRadius: "var(--r-1)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
        fontSize: mono ? 10 : 10.5,
        fontWeight: 700,
        letterSpacing: mono ? 0 : ".01em",
        border: solid ? "none" : `1px solid ${t.bd === "transparent" ? "transparent" : t.bd}`,
        background: solid ? t.solidBg : t.bg,
        color: solid ? t.solidFg : t.fg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
