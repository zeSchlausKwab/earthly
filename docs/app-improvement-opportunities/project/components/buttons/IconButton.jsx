import React from "react";

/**
 * IconButton — a square 22–30px icon control. Used solo or grouped into a
 * segmented tool rail (pass `grouped` to drop the outer radius/border so siblings
 * butt against a shared 1px divider).
 */
export function IconButton({
  size = "md",
  active = false,
  grouped = false,
  title,
  children,
  style,
  ...rest
}) {
  const S = { sm: 22, md: 26, lg: 30 }[size] || 26;
  return (
    <button
      title={title}
      style={{
        width: S,
        height: S,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: grouped ? "none" : "1px solid var(--border-strong)",
        borderRadius: grouped ? 0 : "var(--r-1)",
        background: active ? "var(--accent-active)" : "var(--surface-raised)",
        color: active ? "var(--accent-ink)" : "var(--text-muted)",
        cursor: "pointer",
        boxSizing: "border-box",
        ...style,
      }}
      {...rest}
    >
      <span style={{ display: "inline-flex", width: size === "sm" ? 12 : 14, height: size === "sm" ? 12 : 14 }}>
        {children}
      </span>
    </button>
  );
}

/**
 * IconButtonGroup — wraps IconButtons into a bordered segmented rail with
 * 1px dividers between them. Pass `grouped` IconButtons as children.
 */
export function IconButtonGroup({ children, style }) {
  const items = React.Children.toArray(children);
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-1)",
        overflow: "hidden",
        ...style,
      }}
    >
      {items.map((child, i) => (
        <div key={i} style={{ borderLeft: i ? "1px solid var(--border-hairline)" : "none", display: "inline-flex" }}>
          {child}
        </div>
      ))}
    </div>
  );
}
