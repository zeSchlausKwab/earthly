import React from "react";

/**
 * Menu — a floating popover list (dropdowns, context menus, the panel switcher,
 * the command palette body). Items support an icon, a label, a trailing keycap or
 * check, a `danger` tone, and `active` highlight. Use MenuGroup for a caps label,
 * MenuSeparator for a divider.
 */
export function Menu({ width = 200, children, style }) {
  return (
    <div
      style={{
        width,
        background: "var(--surface-raised)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-2)",
        boxShadow: "var(--shadow-pop)",
        padding: 4,
        fontFamily: "var(--font-ui)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function MenuGroup({ children }) {
  return (
    <div style={{ padding: "6px 8px 3px" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-faint)" }}>{children}</span>
    </div>
  );
}

export function MenuSeparator() {
  return <div style={{ height: 1, background: "var(--border-hairline)", margin: "4px 0" }} />;
}

export function MenuItem({ icon = null, children, keycap = null, active = false, checked = false, danger = false, onClick, style }) {
  const color = danger ? "var(--accent-danger)" : active ? "var(--text-primary)" : "var(--text-body)";
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        height: 28,
        padding: "0 8px",
        borderRadius: "var(--r-1)",
        background: active ? "var(--fill-active-14)" : "transparent",
        color,
        cursor: "pointer",
        ...style,
      }}
    >
      {icon ? <span style={{ display: "inline-flex", width: 14, height: 14, color: active ? "var(--accent-active-text)" : "var(--text-muted)" }}>{icon}</span> : null}
      <span style={{ flex: 1, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {checked ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-active-text)" strokeWidth="2.5" style={{ width: 13, height: 13 }}><path d="M20 6 9 17l-5-5" /></svg>
      ) : null}
      {keycap ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-faint)" }}>{keycap}</span> : null}
    </div>
  );
}
