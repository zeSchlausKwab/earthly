import * as React from "react";

/**
 * The dense, cornered action button. Amber `primary` for the one commit action per
 * context; `secondary` (hairline) for everything else; `ghost` for tertiary; `danger`
 * for destructive. Never more than one primary in a toolbar or panel footer.
 *
 * @startingPoint section="Buttons" subtitle="Primary / secondary / ghost / danger" viewport="700x120"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. @default "secondary" */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Control height. sm=22 md=26 lg=30. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Optional 14px icon node rendered before the label. */
  iconLeft?: React.ReactNode;
  disabled?: boolean;
}

export function Button(props: ButtonProps): React.ReactElement;
