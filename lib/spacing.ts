// Buddy Design System Spacing Scale
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// Common Layout Patterns
export const layout = {
  // Screen padding
  screenPaddingX: spacing.xxl, // 24 - standard horizontal padding
  screenPaddingY: spacing.xxl, // 24 - standard vertical padding
  screenPaddingTop: spacing.xxxl, // 32 - for status bar + header
  
  // Section spacing
  sectionMarginBottom: spacing.xxxl, // 32 - between major sections
  sectionGap: spacing.xxl, // 24 - between cards in a section
  
  // Component spacing
  cardPadding: spacing.xl, // 20 - inside cards
  cardMarginBottom: spacing.lg, // 16 - between cards
  
  // Input/Button
  inputHeight: 48, // Standard input height
  buttonHeight: 48, // Standard button height
  smallButtonHeight: 40, // For secondary buttons
  
  // Gap between items
  itemGap: spacing.lg, // 16 - between list items
  componentGap: spacing.md, // 12 - between small components
  
  // Border radius
  borderRadiusSmall: spacing.lg, // 16
  borderRadiusMedium: 20,
  borderRadiusLarge: spacing.xxl, // 24
  
  // Shadow/elevation
  shadowSmall: 2,
  shadowMedium: 3,
  shadowLarge: 4,
} as const;
