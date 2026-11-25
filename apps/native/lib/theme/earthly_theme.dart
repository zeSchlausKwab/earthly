import 'dart:ui';

import 'package:material_ui/material_ui.dart';

/// Earthly Field Instrument colour tokens — harmonized with Earthly Web's
/// warm-paper light + cool-graphite dark aesthetic and signature luminous amber.
abstract final class EarthlyColors {
  // Light palette (Warm Cartographic Parchment)
  static const lightGround = Color(0xFFECEBE6);
  static const lightSurface = Color(0xFFF9F8F4);
  static const lightCard = Color(0xFFFFFFFF);
  static const lightField = Color(0xFFF1EFE9);
  static const lightInk = Color(0xFF191815);
  static const lightMuted = Color(0xFF6B6860);
  static const lightAccent = Color(0xFFB86B00); // high-contrast burnished amber on light

  // Dark palette (Cool Graphite Field Instrument)
  static const darkGround = Color(0xFF131417);
  static const darkSurface = Color(0xFF1B1C20);
  static const darkRaised = Color(0xFF25262C);
  static const darkField = Color(0xFF222329);
  static const darkInk = Color(0xFFF0F1F4);
  static const darkMuted = Color(0xFF989AA6);
  static const darkAccent = Color(0xFFF5B727); // unmissable luminous amber on dark

  // Signature Earthly Luminous Amber CTA (shared across light & dark)
  static const amber = Color(0xFFF5B727);
  static const amberInk = Color(0xFF1F1808);

  // Scarce semantic cartographic accents
  static const published = Color(0xFF6B7280);
  static const infoCyan = Color(0xFF0E7490);
  static const infoCyanBright = Color(0xFF38BDF8);
  static const proposedAmber = Color(0xFFD97706);
  static const commentGreen = Color(0xFF16A34A);
  static const measureViolet = Color(0xFF7C3AED);
  static const destructive = Color(0xFFDC2626);
}

ThemeData buildEarthlyTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final ground = isDark ? EarthlyColors.darkGround : EarthlyColors.lightGround;
  final surface = isDark ? EarthlyColors.darkSurface : EarthlyColors.lightSurface;
  final card = isDark ? EarthlyColors.darkRaised : EarthlyColors.lightCard;
  final field = isDark ? EarthlyColors.darkField : EarthlyColors.lightField;
  final ink = isDark ? EarthlyColors.darkInk : EarthlyColors.lightInk;
  final muted = isDark ? EarthlyColors.darkMuted : EarthlyColors.lightMuted;
  final accent = isDark ? EarthlyColors.darkAccent : EarthlyColors.lightAccent;
  final hairline = isDark
      ? Colors.white.withValues(alpha: 0.11)
      : Colors.black.withValues(alpha: 0.09);

  final scheme = ColorScheme(
    brightness: brightness,
    primary: accent,
    onPrimary: isDark ? EarthlyColors.amberInk : Colors.white,
    primaryContainer: EarthlyColors.amber.withValues(alpha: isDark ? 0.22 : 0.18),
    onPrimaryContainer: isDark ? EarthlyColors.amber : const Color(0xFF5A3400),
    secondary: isDark ? EarthlyColors.infoCyanBright : EarthlyColors.infoCyan,
    onSecondary: isDark ? EarthlyColors.darkGround : Colors.white,
    secondaryContainer:
        EarthlyColors.infoCyanBright.withValues(alpha: isDark ? 0.18 : 0.14),
    onSecondaryContainer:
        isDark ? EarthlyColors.infoCyanBright : const Color(0xFF0B4F64),
    error: EarthlyColors.destructive,
    onError: Colors.white,
    surface: surface,
    onSurface: ink,
    surfaceContainerHighest: card,
    onSurfaceVariant: muted,
    outline: hairline,
  );

  final fieldBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(11),
    borderSide: BorderSide(color: hairline),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: ground,
    dividerColor: hairline,
    textTheme: Typography.material2021().black.apply(
          bodyColor: ink,
          displayColor: ink,
        ).copyWith(
          titleMedium: TextStyle(
            color: ink,
            fontSize: 16,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
          ),
          titleSmall: TextStyle(
            color: ink,
            fontSize: 14,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.1,
          ),
          labelLarge: TextStyle(
            color: ink,
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.8,
          ),
          labelSmall: TextStyle(
            color: muted,
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.9,
          ),
          bodySmall: TextStyle(
            color: muted,
            fontSize: 12.5,
            height: 1.4,
          ),
        ),
    cardTheme: CardThemeData(
      color: card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: hairline),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: EarthlyColors.amber,
        foregroundColor: EarthlyColors.amberInk,
        disabledBackgroundColor: hairline,
        disabledForegroundColor: muted,
        elevation: 0,
        textStyle: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.1,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ink,
        backgroundColor: card.withValues(alpha: isDark ? 0.65 : 0.75),
        side: BorderSide(color: hairline),
        textStyle: const TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: accent,
        textStyle: const TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w700,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: field,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      hintStyle: TextStyle(color: muted, fontSize: 13),
      labelStyle: TextStyle(color: muted, fontSize: 12.5),
      border: fieldBorder,
      enabledBorder: fieldBorder,
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(11),
        borderSide: BorderSide(color: EarthlyColors.amber, width: 1.6),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: field,
      selectedColor: EarthlyColors.amber.withValues(alpha: isDark ? 0.24 : 0.22),
      checkmarkColor: isDark ? EarthlyColors.amber : EarthlyColors.amberInk,
      side: BorderSide(color: hairline),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      labelStyle: TextStyle(
        color: ink,
        fontSize: 12,
        fontWeight: FontWeight.w600,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
        ),
        side: WidgetStatePropertyAll(BorderSide(color: hairline)),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return EarthlyColors.amber;
          }
          return field;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return EarthlyColors.amberInk;
          }
          return ink;
        }),
      ),
    ),
    tabBarTheme: TabBarThemeData(
      labelColor: isDark ? EarthlyColors.amber : ink,
      unselectedLabelColor: muted,
      indicatorColor: EarthlyColors.amber,
      indicatorSize: TabBarIndicatorSize.label,
      dividerColor: hairline,
      labelStyle: const TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.1,
      ),
      unselectedLabelStyle: const TextStyle(
        fontSize: 12.5,
        fontWeight: FontWeight.w500,
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: isDark ? EarthlyColors.darkRaised : const Color(0xFF1F1E1B),
      contentTextStyle: const TextStyle(
        color: Color(0xFFF5F5F7),
        fontSize: 13,
        fontWeight: FontWeight.w500,
      ),
      actionTextColor: EarthlyColors.amber,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: hairline),
      ),
    ),
    dividerTheme: DividerThemeData(color: hairline, thickness: 1),
  );
}

/// Frosted-glass floating cartographic surface with crisp specular hairline and
/// soft ambient lift shadow over the live GPU map canvas.
class EarthlyGlassSurface extends StatelessWidget {
  const EarthlyGlassSurface({
    required this.child,
    this.borderRadius = const BorderRadius.all(Radius.circular(14)),
    this.padding,
    this.color,
    this.borderColor,
    this.borderWidth = 1.0,
    this.blurSigma = 14.0,
    this.shadows,
    super.key,
  });

  final Widget child;
  final BorderRadius borderRadius;
  final EdgeInsetsGeometry? padding;
  final Color? color;
  final Color? borderColor;
  final double borderWidth;
  final double blurSigma;
  final List<BoxShadow>? shadows;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final fill = color ??
        (isDark
            ? EarthlyColors.darkSurface.withValues(alpha: 0.84)
            : EarthlyColors.lightSurface.withValues(alpha: 0.88));
    final stroke = borderColor ??
        (isDark
            ? Colors.white.withValues(alpha: 0.12)
            : Colors.black.withValues(alpha: 0.09));

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: borderRadius,
        boxShadow: shadows ??
            [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.38 : 0.14),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
      ),
      child: ClipRRect(
        borderRadius: borderRadius,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blurSigma, sigmaY: blurSigma),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              color: fill,
              borderRadius: borderRadius,
              border: Border.all(color: stroke, width: borderWidth),
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// Crisp uppercase monospace pill badge for entity kinds, geometry tags, and states.
class EarthlyBadge extends StatelessWidget {
  const EarthlyBadge({
    required this.label,
    required this.color,
    this.filled = false,
    super.key,
  });

  final String label;
  final Color color;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: filled ? color : color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: filled ? color : color.withValues(alpha: 0.35),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: 'monospace',
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.6,
          color: filled ? Colors.white : color,
        ),
      ),
    );
  }
}
