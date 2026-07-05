import * as React from "react";

/**
 * The framed surface primitive — header (title + meta + actions), body, optional
 * footer. `floating` adds the map-panel shadow; docked panels stay border-only.
 * Datasets, Sightings, Map Stack, Basemap — every side panel is a Panel.
 *
 * @startingPoint section="Surfaces" subtitle="Framed panel with header + footer" viewport="700x360"
 */
export interface PanelProps {
  title: React.ReactNode;
  /** 14px header icon (amber-tinted). */
  icon?: React.ReactNode;
  /** Mono meta pinned right in the header. */
  meta?: React.ReactNode;
  /** Header action nodes (icon buttons). */
  actions?: React.ReactNode;
  /** Footer nodes (usually buttons). */
  footer?: React.ReactNode;
  /** Add the floating shadow for over-map panels. @default false */
  floating?: boolean;
  width?: number | string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export function Panel(props: PanelProps): React.ReactElement;
