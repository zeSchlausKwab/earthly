import * as React from "react";

/**
 * Square icon control (22/26/30px). `active` paints an amber fill — used for the
 * selected tool. Wrap several `grouped` IconButtons in IconButtonGroup to build the
 * segmented tool rail that runs across the toolbar and the mobile Build strip.
 *
 * @startingPoint section="Buttons" subtitle="Icon buttons + segmented tool rail" viewport="700x100"
 */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** @default "md" */
  size?: "sm" | "md" | "lg";
  /** Amber-fill selected state (active tool). @default false */
  active?: boolean;
  /** Drop own border/radius to sit inside an IconButtonGroup. @default false */
  grouped?: boolean;
  /** Tooltip / accessible label. */
  title?: string;
  /** A single 12–14px icon node. */
  children: React.ReactNode;
}
export function IconButton(props: IconButtonProps): React.ReactElement;

export interface IconButtonGroupProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export function IconButtonGroup(props: IconButtonGroupProps): React.ReactElement;
