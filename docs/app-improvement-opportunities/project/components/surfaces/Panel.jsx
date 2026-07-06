import React from "react";

/**
 * Panel — the framed surface primitive: a 30–38px header (title + trailing actions)
 * over a body, with an optional footer. `floating` adds the shadow used when a panel
 * sits over the map; docked panels use only the hairline border.
 */
export function Panel({ title, icon = null, meta = null, actions = null, footer = null, floating = false, width, children, style }) {
  return (
    <div
      style={{
        width,
        background: "var(--surface-panel)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-2)",
        boxShadow: floating ? "var(--shadow-panel)" : "none",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-ui)",
        ...style,
      }}
    >
      <div
        style={{
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          borderBottom: "1px solid var(--border-hairline)",
          flexShrink: 0,
        }}
      >
        {icon ? <span style={{ display: "inline-flex", width: 14, height: 14, color: "var(--accent-active-text)" }}>{icon}</span> : null}
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        {meta ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-faint)", marginLeft: "auto" }}>{meta}</span> : null}
        {actions ? <span style={{ marginLeft: meta ? 8 : "auto", display: "inline-flex", gap: 4 }}>{actions}</span> : null}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
      {footer ? (
        <div style={{ borderTop: "1px solid var(--border-hairline)", padding: 6, display: "flex", gap: 6, flexShrink: 0 }}>{footer}</div>
      ) : null}
    </div>
  );
}
