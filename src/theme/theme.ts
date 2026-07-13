import {
  MD3LightTheme,
  MD3DarkTheme,
  configureFonts,
  type MD3Theme,
} from 'react-native-paper';

/**
 * Brand palette recovered from `app.config`:
 *   primary green #2f6b26, accent #2E7D32, splash light #96d784 / dark #15520f.
 */
export const brand = {
  green: '#2f6b26',
  greenAccent: '#2E7D32',
  greenLight: '#96d784',
  greenDark: '#15520f',
  greenSurface: '#eaf3e6',
} as const;

const fontConfig = configureFonts({ config: { fontFamily: undefined } });

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  fonts: fontConfig,
  colors: {
    ...MD3LightTheme.colors,
    primary: brand.green,
    primaryContainer: brand.greenSurface,
    secondary: brand.greenAccent,
    background: '#f6f8f4',
    surface: '#ffffff',
    surfaceVariant: '#e6ede1',
  },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  fonts: fontConfig,
  colors: {
    ...MD3DarkTheme.colors,
    primary: brand.greenLight,
    primaryContainer: brand.greenDark,
    secondary: brand.greenLight,
    background: '#0f140d',
    surface: '#151b12',
  },
};
