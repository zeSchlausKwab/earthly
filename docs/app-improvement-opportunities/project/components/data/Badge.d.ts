import * as React from "react";

/**
 * Tiny status/type marker. Translucent tint by default; `solid` for LIVE. Also the
 * geometry type chip: <Badge tone="violet">Poly</Badge>, <Badge tone="cyan">Line</Badge>.
 * `mono` for counts like 12/43.
 *
 * @startingPoint section="Data" subtitle="Status, type chips, counts" viewport="700x90"
 */
export interface BadgeProps {
  /** @default "neutral" */
  tone?: "neutral" | "amber" | "cyan" | "green" | "red" | "violet";
  /** Filled instead of tinted — reserve for LIVE. @default false */
  solid?: boolean;
  /** JetBrains Mono, for numeric counts. @default false */
  mono?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export function Badge(props: BadgeProps): React.ReactElement;
