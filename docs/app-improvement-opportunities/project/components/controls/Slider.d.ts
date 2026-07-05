import * as React from "react";
/**
 * Thin 4px track, amber fill, square handle, trailing mono value. Opacity, stroke
 * width, overlay strength. No round thumb.
 * @startingPoint section="Controls" subtitle="Slider" viewport="700x80"
 */
export interface SliderProps {
  value?: number;
  min?: number;
  max?: number;
  showValue?: boolean;
  unit?: string;
  onChange?: (value: number) => void;
  style?: React.CSSProperties;
}
export function Slider(props: SliderProps): React.ReactElement;
