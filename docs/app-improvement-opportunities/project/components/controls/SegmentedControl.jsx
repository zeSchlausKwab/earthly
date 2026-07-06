import React from "react";

/**
 * SegmentedControl — the cornered mode/tab switch. One amber-filled active segment.
 * Used for the Looking / Focusing / Making stance and for panel sub-tabs.
 */
export function SegmentedControl({ options = [], value, onChange, size = "md", style }) {
  const H = { sm: 22, md: 26, lg: 30 }[size] || 26;
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--surface-sunken)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-1)",
        padding: 2,
        gap: 2,
        boxSizing: "border-box",
        ...style,
      }}
    >
      {options.map((opt) => {
        const val = typeof opt === "string" ? opt : opt.value;
        const label = typeof opt === "string" ? opt : opt.label;
        const on = val === value;
        return (
          <button
            key={val}
            onClick={() => onChange && onChange(val)}
            style={{
              height: H - 6,
              padding: "0 11px",
              border: "none",
              borderRadius: 1,
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: on ? 600 : 500,
              cursor: "pointer",
              background: on ? "var(--accent-active)" : "transparent",
              color: on ? "var(--accent-ink)" : "var(--text-muted)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
