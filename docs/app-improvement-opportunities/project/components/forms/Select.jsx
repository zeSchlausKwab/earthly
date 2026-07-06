import React from "react";

/**
 * Select — a 26px field that opens a menu. Renders as the closed trigger (value +
 * chevron); wire it to a Menu for the open state. Cornered, sunken, hairline border.
 */
export function Select({ value, placeholder = "Select…", size = "md", onClick, style }) {
  const H = { sm: 22, md: 26, lg: 30 }[size] || 26;
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: H,
        padding: "0 8px",
        background: "var(--surface-sunken)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-1)",
        color: value ? "var(--text-primary)" : "var(--text-faint)",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        cursor: "pointer",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value || placeholder}
      </span>
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" style={{ width: 11, height: 11, flexShrink: 0 }}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
