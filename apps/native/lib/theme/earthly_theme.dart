import 'package:material_ui/material_ui.dart';

/// Earthly layout & colour tokens derived from docs/MAP-WITH-A-MARGIN-SPEC.md.
abstract final class EarthlyColors {
  // Light palette
  static const lightGround = Color(0xFFEDF0EA);
  static const lightSurface = Color(0xFFF7F8F5);
  static const lightInk = Color(0xFF172019);
  static const lightAccent = Color(0xFF1F5F8B);

  // Dark palette
  static const darkGround = Color(0xFF0E1412);
  static const darkSurface = Color(0xFF161D1A);
  static const darkInk = Color(0xFFE5ECE6);
  static const darkAccent = Color(0xFF74B3E0);

  // Geometry state grammar (shared across light & dark)
  static const published = Color(0xFF6B7280);
  static const proposedAmber = Color(0xFFD97706);
  static const commentGreen = Color(0xFF15803D);
  static const destructive = Color(0xFFB91C1C);
}

ThemeData buildEarthlyTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final ground = isDark ? EarthlyColors.darkGround : EarthlyColors.lightGround;
  final surface = isDark ? EarthlyColors.darkSurface : EarthlyColors.lightSurface;
  final ink = isDark ? EarthlyColors.darkInk : EarthlyColors.lightInk;
  final accent = isDark ? EarthlyColors.darkAccent : EarthlyColors.lightAccent;
  final hairline = ink.withValues(alpha: 0.14);

  final scheme = ColorScheme(
    brightness: brightness,
    primary: accent,
    onPrimary: isDark ? EarthlyColors.darkGround : Colors.white,
    secondary: EarthlyColors.proposedAmber,
    onSecondary: Colors.white,
    error: EarthlyColors.destructive,
    onError: Colors.white,
    surface: surface,
    onSurface: ink,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: ground,
    dividerColor: hairline,
    cardTheme: CardThemeData(
      color: surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
        side: BorderSide(color: hairline),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
        side: BorderSide(color: hairline),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    ),
  );
}
