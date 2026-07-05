import React from "react";

/**
 * Toggle — a square-cornered switch (30×17, 2px radius). Amber when on.
 * Deliberately NOT a pill — matches the cornered language.
 */
export function Toggle({ checked = false, onChange, disabled = false, style }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      style={{
        width: 30,
        height: 17,
        borderRadius: "var(--r-1)",
        border: "none",
        padding: 0,
        position: "relative",
        cursor: disabled ? "default" : "pointer",
        background: checked ? "var(--accent-active)" : "var(--n-border)",
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 15 : 2,
          width: 13,
          height: 13,
          borderRadius: 1,
          background: checked ? "var(--accent-ink)" : "var(--text-muted)",
          transition: "left .12s ease",
        }}
      />
    </button>
  );
}
