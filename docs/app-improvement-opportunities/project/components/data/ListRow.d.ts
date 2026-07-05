import * as React from "react";

/**
 * The dense workhorse row (24–32px): leading dot/icon, title, trailing meta + actions.
 * `selected` = amber left-border + tint. Every dataset, sighting, layer and geometry
 * list is built from these.
 *
 * @startingPoint section="Data" subtitle="Dense list / layer / geometry row" viewport="700x150"
 */
export interface ListRowProps {
  /** 14px leading icon node. */
  icon?: React.ReactNode;
  /** Color for a 8px square status/layer dot (CSS color). */
  dot?: string;
  title: React.ReactNode;
  /** Trailing mono meta (count, vertices). */
  meta?: React.ReactNode;
  /** Trailing action nodes (eye, chevron). */
  trailing?: React.ReactNode;
  /** Amber left-border + tint. @default false */
  selected?: boolean;
  /** Faint text for hidden/disabled rows. @default false */
  muted?: boolean;
  /** Row height px. @default 28 */
  height?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function ListRow(props: ListRowProps): React.ReactElement;
