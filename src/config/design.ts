import type { ThemeConfig } from "antd";
export const pickerPopupAlign = {
  offset: [0, 0] as [number, number],
  overflow: { adjustX: true, adjustY: true, shiftX: 8, shiftY: 8 },
};

export const designTokens = {
  fontFamily: "Arial, Helvetica, sans-serif",
  primary: "#2563eb",
  text: "#1b2c46",
  secondary: "#52637a",
  border: "#dce4ee",
  radius: 12,
  controlHeight: 44,
} as const;

export const appTheme: ThemeConfig = {
  token: {
    fontFamily: designTokens.fontFamily,
    fontSize: 14,
    lineHeight: 1.6,
    colorPrimary: designTokens.primary,
    colorText: designTokens.text,
    colorTextSecondary: designTokens.secondary,
    colorBorder: designTokens.border,
    borderRadius: designTokens.radius,
    controlHeight: designTokens.controlHeight,
    controlHeightLG: 48,
    controlHeightSM: 44,
    padding: 20,
  },
  components: {
    Button: { fontWeight: 600 },
    Typography: { titleMarginTop: 0, titleMarginBottom: 12 },
    Slider: { railSize: 8, handleSize: 22, handleSizeHover: 24 },
    Tooltip: { fontSize: 12 },
    Table: { cellPaddingBlock: 16, cellPaddingInline: 16 },
    Modal: { titleFontSize: 20 },
    Tag: { fontSizeSM: 12 },
    DatePicker: {
      cellHeight: 32,
      cellWidth: 36,
      textHeight: 40,
      timeCellHeight: 44,
      timeColumnHeight: 220,
    },
  },
};
