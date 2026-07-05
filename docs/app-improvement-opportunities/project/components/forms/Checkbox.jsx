import React from "react";

/**
 * Checkbox — a 15px square check (2px radius). Amber fill + ink glyph when checked.
 */
export function Checkbox({ checked = false, onChange, disabled = false, label = null, style }) {
  const box = (
    <span
      style={{
        width: 15,
        height: 15,
        borderRadius: "var(--r-1)",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: checked ? "var(--accent-active)" : "var(--surface-sunken)",
        border: checked ? "none" : "1px solid var(--border-strong)",
      }}
    >
      {checked ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 10, height: 10 }}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : null}
    </span>
  );
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", padding: 0, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, ...style }}
    >
      {box}
      {label != null ? <span style={{ fontSize: 12, color: "var(--text-body)" }}>{label}</span> : null}
    </button>
  );
}
