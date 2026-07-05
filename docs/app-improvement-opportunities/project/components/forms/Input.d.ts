import * as React from "react";

/**
 * 26px sunken text field. Use `numeric` for coordinates/counts (right-aligned mono),
 * and `suffix` for a trailing unit, stepper or color swatch. The default control for
 * names, search, and property values.
 *
 * @startingPoint section="Forms" subtitle="Text + numeric fields" viewport="700x110"
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  value?: string;
  placeholder?: string;
  /** Right-aligned JetBrains Mono for numeric values. @default false */
  numeric?: boolean;
  /** Trailing node — unit label, stepper, swatch. */
  suffix?: React.ReactNode;
  /** @default "md" */
  size?: "sm" | "md" | "lg";
}
export function Input(props: InputProps): React.ReactElement;
