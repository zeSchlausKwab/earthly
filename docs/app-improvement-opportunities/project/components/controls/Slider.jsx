import React from "react";

/**
 * Slider — thin track (4px) with amber fill and a small SQUARE handle (10×12, 2px).
 * Optional trailing mono value. Matches the cornered language — no round thumb.
 */
export function Slider({ value = 50, min = 0, max = 100, showValue = true, unit = "%", onChange, style }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, ...style }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--surface-sunken)", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct + "%", background: "var(--accent-active)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: `calc(${pct}% - 5px)`, top: -4, width: 10, height: 12, borderRadius: 2, background: "var(--text-body)", border: "1px solid var(--border-strong)" }} />
      </div>
      {showValue ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-body)", width: 34, textAlign: "right" }}>
          {Math.round(value)}{unit}
        </span>
      ) : null}
    </div>
  );
}
