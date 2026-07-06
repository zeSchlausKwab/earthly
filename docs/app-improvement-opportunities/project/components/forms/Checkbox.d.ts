import * as React from "react";
/**
 * 15px square checkbox, amber fill + ink check when on. Optional inline label.
 * @startingPoint section="Forms" subtitle="Checkbox" viewport="700x80"
 */
export interface CheckboxProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Checkbox(props: CheckboxProps): React.ReactElement;
