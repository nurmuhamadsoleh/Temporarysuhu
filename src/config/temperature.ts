/** Initial company Freezer policy; administrators can save a new version. */
export const FREEZER_TEMPERATURE_POLICY = {
  minSlider: -22,
  maxSlider: -6,
  step: 0.1,
  normalMin: -18,
  normalMax: -10,
  warningMax: -8,
} as const;
