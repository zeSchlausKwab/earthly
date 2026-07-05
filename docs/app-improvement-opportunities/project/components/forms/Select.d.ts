import * as React from "react";
/**
 * 26px select trigger (value + chevron). Pair with Menu for the open list. Use when
 * options are many or long; for 2–4 short options use SegmentedControl instead.
 * @startingPoint section="Forms" subtitle="Select trigger" viewport="700x90"
 */
export interface SelectProps {
  value?: string;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function Select(props: SelectProps): React.ReactElement;
