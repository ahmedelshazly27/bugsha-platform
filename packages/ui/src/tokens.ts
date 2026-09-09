/** Bugsha design tokens (design system tokens/semantic.css, typography.css, space.css). Two colours: violet + white; ink ramp for everything else. */
export const palette = {
  violet900: '#2E1065', violet800: '#4C1D95', violet700: '#5B21B6', violet600: '#6D28D9',
  violet300: '#C4B5FD', violet200: '#DDD6FE', violet100: '#EDE9FE', violet50: '#F5F3FF',
  ink900: '#17141F', ink700: '#312B40', ink500: '#6B6579', ink400: '#9A94A8', ink200: '#E7E4EE', ink100: '#F1EFF6',
  paper: '#FFFFFF', canvas: '#F8F7FB',
} as const;
export const color = {
  canvas: palette.canvas, raised: palette.paper, sunken: palette.ink100, inverse: palette.ink900, brandSurface: palette.violet700,
  overlay: 'rgba(20,12,36,0.58)',
  text: palette.ink900, textSecondary: palette.ink500, textTertiary: palette.ink400, textInverse: '#FFFFFF', textOnBrand: '#FFFFFF', link: palette.violet700,
  borderSubtle: palette.ink200, border: '#DCD8E6', borderStrong: palette.ink700, focus: palette.violet700,
  brand: palette.violet700, brandHover: palette.violet800, brandPress: palette.violet900, brandTint: palette.violet100,
  fresh: palette.ink700, freshTint: palette.ink100, time: palette.violet700, timeTint: palette.violet100,
  timeUrgent: palette.violet800, timeUrgentTint: palette.violet200, error: '#8B1D3F', errorTint: '#F6E4EA',
  info: palette.ink700, infoTint: palette.ink100, deal: palette.violet700, dealOn: '#FFFFFF', rating: palette.violet700, skeleton: palette.ink100,
} as const;
export const radius = { card: 10, control: 8, chip: 6, sheet: 16, image: 8, pill: 999 } as const;
export const space = { 25: 2, 50: 4, 75: 6, 100: 8, 150: 12, 200: 16, 250: 20, 300: 24, 400: 32, 500: 40, 600: 48, 800: 64 } as const;
export const size = { touchMin: 44, touchComfort: 52, controlSm: 32, controlMd: 44, controlLg: 52 } as const;
/** size/line pairs from typography.css */
export const type = {
  displayXl: [40, 44], display: [32, 36], titleLg: [24, 30], title: [20, 26], headline: [17, 24], bodyLg: [17, 26], body: [15, 22],
  label: [13, 18], caption: [12, 16], micro: [11, 14], numericXl: [34, 34], code: [36, 40],
} as const;
export const arabic = { sizeScale: 0.96, lineScale: 1.18 } as const;
export const shadow = {
  card: { shadowColor: '#2A1F45', shadowOpacity: 0.07, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  raised: { shadowColor: '#2A1F45', shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
} as const;
