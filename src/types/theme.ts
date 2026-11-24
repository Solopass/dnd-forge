export type ThemeDisplayFont = 'Inter' | 'Cinzel' | 'Fraunces' | 'Space Grotesk' | 'System';
export type ThemeBodyFont = 'Inter' | 'Fraunces' | 'System';
export type ThemeMonoFont = 'JetBrains Mono' | 'Fira Code' | 'System Monospace';

export type ThemeRadiusScale = 'sharp' | 'balanced' | 'rounded' | 'pill';
export type ThemeElevation = 'flat' | 'subtle' | 'elevated' | 'glass';
export type ThemeTexture = 'none' | 'parchment' | 'grid' | 'noise';
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';

export interface ThemeTokens {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgCardHeader: string;
  borderSubtle: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentBrand: string;
  accentSecondary: string;
  accentSuccess: string;
  accentDanger: string;
  accentWarning: string;
}

export interface ThemeTypography {
  displayFont: ThemeDisplayFont;
  bodyFont: ThemeBodyFont;
  monoFont: ThemeMonoFont;
  fontScale: number; // 0.9 to 1.2
}

export interface ThemeSurfaceStyle {
  radiusScale: ThemeRadiusScale;
  elevation: ThemeElevation;
  texture: ThemeTexture;
  density: ThemeDensity;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  author?: string;
  description?: string;
  colorScheme: 'dark' | 'light';
  builtIn?: boolean;
  tokens: ThemeTokens;
  typography: ThemeTypography;
  surface: ThemeSurfaceStyle;
}
