/** Archivo (Latin), Alexandria (Arabic), IBM Plex Mono (numerals) — the shipping pairing. Loaded once at app root. */
import { useFonts } from 'expo-font';
import { Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold, Archivo_700Bold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { Alexandria_300Light, Alexandria_400Regular, Alexandria_500Medium, Alexandria_700Bold } from '@expo-google-fonts/alexandria';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono';
import { I18nManager } from 'react-native';

export const FONT_MAP = {
  Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold, Archivo_700Bold, Archivo_800ExtraBold,
  Alexandria_300Light, Alexandria_400Regular, Alexandria_500Medium, Alexandria_700Bold,
  IBMPlexMono_400Regular, IBMPlexMono_500Medium, IBMPlexMono_700Bold,
};
export function useBugshaFonts(): boolean { const [ok] = useFonts(FONT_MAP); return ok; }

export type Weight = 400 | 500 | 600 | 700 | 800;
const LATIN: Record<Weight, string> = { 400: 'Archivo_400Regular', 500: 'Archivo_500Medium', 600: 'Archivo_600SemiBold', 700: 'Archivo_700Bold', 800: 'Archivo_800ExtraBold' };
const ARABIC: Record<Weight, string> = { 400: 'Alexandria_400Regular', 500: 'Alexandria_500Medium', 600: 'Alexandria_500Medium', 700: 'Alexandria_700Bold', 800: 'Alexandria_700Bold' };
const MONO: Record<Weight, string> = { 400: 'IBMPlexMono_400Regular', 500: 'IBMPlexMono_500Medium', 600: 'IBMPlexMono_500Medium', 700: 'IBMPlexMono_700Bold', 800: 'IBMPlexMono_700Bold' };
export const isRTL = () => I18nManager.isRTL;
/** The family name for a weight, in the script the layout is running in. */
export const fontFor = (weight: Weight = 400, arabicScript = isRTL()) => (arabicScript ? ARABIC[weight] : LATIN[weight]);
export const monoFor = (weight: Weight = 400) => MONO[weight];
