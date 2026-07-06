import * as React from "react";

/**
 * Cornered segmented switch with one amber-filled active segment. The canonical
 * home for the always-visible stance (Looking / Focusing / Making) and for panel
 * sub-tabs. 2–4 short options; past that use a dropdown.
 *
 * @startingPoint section="Controls" subtitle="Segmented mode / tab switch" viewport="700x90"
 */
export interface SegmentedOption {
  value: string;
  label: string;
}
export interface SegmentedControlProps {
  /** Strings or {value,label} objects. */
  options: Array<string | SegmentedOption>;
  value: string;
  onChange?: (value: string) => void;
  /** @default "md" */
  size?: "sm" | "md" | "lg";
  style?: React.CSSProperties;
}
export function SegmentedControl(props: SegmentedControlProps): React.ReactElement;
