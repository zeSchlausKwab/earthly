import React from "react";

/**
 * ListRow — the workhorse dense row (24–32px). Optional leading swatch dot / icon,
 * a title, trailing meta + actions. `selected` paints the amber left-border + tint.
 * This is every dataset, sighting, layer and geometry row.
 */
export function ListRow({
  icon = null,
  dot = null,
  title,
  meta = null,
  trailing = null,
  selected = false,
  muted = false,
  height = 28,
  onClick,
  style,
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height,
        padding: selected ? "0 8px 0 6px" : "0 8px",
        borderLeft: selected ? "2px solid var(--accent-active)" : "2px solid transparent",
        background: selected ? "var(--fill-active-14)" : "transparent",
        borderBottom: "1px solid var(--border-hairline)",
        cursor: onClick ? "pointer" : "default",
        boxSizing: "border-box",
        ...style,
      }}
    >
      {dot ? <span style={{ width: 8, height: 8, borderRadius: 1, background: dot, flexShrink: 0 }} /> : null}
      {icon ? <span style={{ display: "inline-flex", width: 14, height: 14, color: "var(--text-faint)", flexShrink: 0 }}>{icon}</span> : null}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          fontWeight: selected ? 600 : 400,
          color: muted ? "var(--text-faint)" : selected ? "var(--text-primary)" : "var(--text-body)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      {meta ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-faint)" }}>{meta}</span> : null}
      {trailing}
    </div>
  );
}
