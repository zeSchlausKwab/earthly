import * as React from "react";

/**
 * Square-cornered switch (30×17). Amber when on. For per-row on/off — layer
 * visibility, "let others attach", snap-to-grid, overlay toggles. Never a pill.
 *
 * @startingPoint section="Forms" subtitle="Toggle switch" viewport="700x90"
 */
export interface ToggleProps {
  /** @default false */
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export function Toggle(props: ToggleProps): React.ReactElement;
