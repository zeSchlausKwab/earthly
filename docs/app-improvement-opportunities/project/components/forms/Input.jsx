import React from "react";

/**
 * Input — 26px sunken text field. Optional trailing `suffix` (units, a stepper,
 * a color swatch). Mono numeric mode right-aligns and switches to JetBrains Mono.
 */
export function Input({
  value,
  placeholder,
  numeric = false,
  suffix = null,
  size = "md",
  style,
  ...rest
}) {
  const H = { sm: 22, md: 26, lg: 30 }[size] || 26;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: H,
        padding: "0 8px",
        background: "var(--surface-sunken)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-1)",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <input
        value={value}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-primary)",
          fontFamily: numeric ? "var(--font-mono)" : "var(--font-ui)",
          fontSize: 12,
          textAlign: numeric ? "right" : "left",
        }}
        {...rest}
      />
      {suffix ? (
        <span style={{ display: "inline-flex", alignItems: "center", color: "var(--text-faint)", fontSize: 11 }}>
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
