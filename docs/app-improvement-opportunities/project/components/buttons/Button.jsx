import React from "react";

/**
 * Button — the dense, cornered action control.
 * Heights: sm 22 / md 26 / lg 30. Radius 2px. Amber primary, hairline secondary.
 */
export function Button({
  variant = "secondary",
  size = "md",
  iconLeft = null,
  disabled = false,
  children,
  style,
  ...rest
}) {
  const H = { sm: 22, md: 26, lg: 30 }[size] || 26;
  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: H,
    padding: size === "sm" ? "0 9px" : "0 12px",
    borderRadius: "var(--r-1)",
    fontFamily: "var(--font-ui)",
    fontSize: size === "sm" ? 11 : 12,
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: "nowrap",
    border: "1px solid transparent",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1,
    boxSizing: "border-box",
  };
  const variants = {
    primary: { background: "var(--accent-active)", color: "var(--accent-ink)" },
    secondary: {
      background: "var(--surface-raised)",
      color: "var(--text-body)",
      borderColor: "var(--border-strong)",
    },
    ghost: { background: "transparent", color: "var(--text-muted)" },
    danger: {
      background: "transparent",
      color: "var(--accent-danger)",
      borderColor: "color-mix(in oklch, var(--accent-danger) 55%, transparent)",
    },
  };
  return (
    <button
      disabled={disabled}
      style={{ ...base, ...(variants[variant] || variants.secondary), ...style }}
      {...rest}
    >
      {iconLeft ? (
        <span style={{ display: "inline-flex", width: 14, height: 14 }}>{iconLeft}</span>
      ) : null}
      {children}
    </button>
  );
}
