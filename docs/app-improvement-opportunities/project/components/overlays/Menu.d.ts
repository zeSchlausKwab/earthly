import * as React from "react";

/**
 * Floating popover list — dropdowns, context menus, the left-panel switcher, and the
 * command-palette body. Compose from MenuItem, with MenuGroup (caps label) and
 * MenuSeparator. `shadow-pop` + raised surface. Keycaps and checks go trailing.
 *
 * @startingPoint section="Overlays" subtitle="Menu / dropdown / command palette" viewport="700x320"
 */
export interface MenuProps {
  width?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export function Menu(props: MenuProps): React.ReactElement;

export interface MenuItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  /** Trailing keycap hint, e.g. "⌘D". */
  keycap?: React.ReactNode;
  /** Highlighted (hover/selected) row. */
  active?: boolean;
  /** Trailing check (current value in a switcher). */
  checked?: boolean;
  /** Red destructive item. */
  danger?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function MenuItem(props: MenuItemProps): React.ReactElement;

export function MenuGroup(props: { children: React.ReactNode }): React.ReactElement;
export function MenuSeparator(): React.ReactElement;
