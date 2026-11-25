import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../theme/earthly_theme.dart';
import 'entity_list_row.dart';

/// Ambient navigation & title-resolution scope inherited by every
/// [EarthlyRichText] across Atlas descriptions, Map descriptions, Stories,
/// Feature properties/callouts, Comments, Proposals, and Author bios.
class EarthlyReferenceScope extends InheritedWidget {
  const EarthlyReferenceScope({
    required this.onOpenNaddr,
    required this.onOpenGeo,
    required this.onOpenPerson,
    required this.resolveNaddrTitle,
    required this.resolvePersonLabel,
    this.onOpenUrl,
    required super.child,
    super.key,
  });

  final Future<void> Function(String naddrUri) onOpenNaddr;
  final void Function(double lat, double lon, String label) onOpenGeo;
  final ValueChanged<String> onOpenPerson;
  final String? Function(DecodedNaddrDto decoded) resolveNaddrTitle;
  final String? Function(String pubkeyHex) resolvePersonLabel;
  final ValueChanged<String>? onOpenUrl;

  static EarthlyReferenceScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<EarthlyReferenceScope>();

  @override
  bool updateShouldNotify(EarthlyReferenceScope oldWidget) => true;
}

/// Cleans Markdown & `nostr:naddr1…` syntax for compact 1–2 line list-row
/// subtitles so raw bech32 blobs and pipe tables never leak into Explore cards.
String stripEarthlyMarkdownPreview(String raw) {
  var text = raw.replaceAll('\r\n', '\n');
  // Remove fenced code blocks & markdown images.
  text = text.replaceAll(RegExp(r'```[\s\S]*?```'), ' ');
  text = text.replaceAll(RegExp(r'!\[[^\]]*\]\([^)]+\)'), ' ');
  // Keep readable link labels for `[Label](nostr:...)` and `[Label](https://...)`.
  text = text.replaceAllMapped(
    RegExp(r'\[([^\]]+)\]\((?:nostr:|geo:|https?://)[^)]+\)', caseSensitive: false),
    (m) => m.group(1) ?? '',
  );
  // Replace bare `nostr:naddr1...` / `naddr1...` with compact label.
  text = text.replaceAll(
    RegExp(
      r'(?:nostr:)?naddr1[023456789acdefghjklmnpqrstuvwxyz]+(?:#[A-Za-z0-9_.\-%]+)?',
      caseSensitive: false,
    ),
    'linked map',
  );
  text = text.replaceAll(
    RegExp(
      r'nostr:(?:npub1|nprofile1)[023456789acdefghjklmnpqrstuvwxyz]+',
      caseSensitive: false,
    ),
    '@user',
  );
  // Drop markdown table separator lines & formatting symbols.
  text = text
      .split('\n')
      .where((line) => !RegExp(r'^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$').hasMatch(line))
      .map((line) => line.replaceFirst(RegExp(r'^\s*(?:#{1,6}\s+|>\s+|[-*]\s+)'), ''))
      .join(' ');
  text = text.replaceAll(RegExp(r'[*_`#|]'), ' ');
  return text.replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// Reusable rich Markdown + GFM Table + interactive Nostr (`nostr:naddr1…`,
/// `[Label](nostr:naddr1…#feat)`, `nostr:npub1…`, `geo:lat,lon`, `https://…`,
/// `![img](...)`) renderer used across all Earthly descriptions and notes.
class EarthlyRichText extends StatefulWidget {
  const EarthlyRichText({
    required this.text,
    this.baseStyle,
    this.compact = false,
    this.preDecodedRefs = const {},
    this.onActivateDecodedNaddr,
    this.onActivateRawNaddr,
    this.onActivateGeo,
    this.onActivatePerson,
    this.onActivateUrl,
    this.titleResolver,
    super.key,
  });

  final String text;
  final TextStyle? baseStyle;
  final bool compact;
  final Map<String, DecodedNaddrDto> preDecodedRefs;
  final ValueChanged<DecodedNaddrDto>? onActivateDecodedNaddr;
  final ValueChanged<String>? onActivateRawNaddr;
  final void Function(double lat, double lon, String label)? onActivateGeo;
  final ValueChanged<String>? onActivatePerson;
  final ValueChanged<String>? onActivateUrl;
  final String? Function(DecodedNaddrDto decoded)? titleResolver;

  /// Shared in-memory decode cache so repeat renders never re-enter FFI.
  static final Map<String, DecodedNaddrDto> _naddrCache = {};
  static final Map<String, String> _npubHexCache = {};

  @override
  State<EarthlyRichText> createState() => _EarthlyRichTextState();
}

final RegExp _bareNaddrScanRe = RegExp(
  r'(?:nostr:)?naddr1[023456789acdefghjklmnpqrstuvwxyz]+(?:#[A-Za-z0-9_.\-%]+)?',
  caseSensitive: false,
);

final RegExp _bareNpubScanRe = RegExp(
  r'nostr:(?:npub1|nprofile1)[023456789acdefghjklmnpqrstuvwxyz]+',
  caseSensitive: false,
);

final RegExp _markdownImageRe = RegExp(
  r'!\[([^\]]*)\]\((https?://[^\s)]+)(?:\s+"([^"]*)")?\)',
);

final RegExp _tableSepRe = RegExp(
  r'^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$',
);

final RegExp _inlineTokenRe = RegExp(
  // 1-2: [label](nostr:naddr1...#feat) or [label](naddr1...#feat)
  r'\[([^\]]+)\]\(((?:nostr:)?naddr1[023456789acdefghjklmnpqrstuvwxyz]+(?:#[A-Za-z0-9_.\-%]+)?)\)'
  // 3-4: [label](geo:lat,lon)
  r'|\[([^\]]+)\]\((geo:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)\)'
  // 5-6: [label](nostr:npub1...|nprofile1...)
  r'|\[([^\]]+)\]\((nostr:(?:npub1|nprofile1)[023456789acdefghjklmnpqrstuvwxyz]+)\)'
  // 7-8: [label](https://...)
  r'|\[([^\]]+)\]\((https?://[^\s)]+)\)'
  // 9: bare nostr:naddr1...#feat or naddr1...#feat
  r'|((?:nostr:)?naddr1[023456789acdefghjklmnpqrstuvwxyz]+(?:#[A-Za-z0-9_.\-%]+)?)'
  // 10: bare nostr:npub1... or nostr:nprofile1...
  r'|(nostr:(?:npub1|nprofile1)[023456789acdefghjklmnpqrstuvwxyz]+)'
  // 11: bare geo:lat,lon
  r'|(\bgeo:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?\b)'
  // 12: bare https://...
  r'|(https?://[^\s<>"{}|\\^`\[\]]+)'
  // 13: `inline code`
  r'|`([^`\n]+)`'
  // 14: **bold**
  r'|\*\*([^*\n]+)\*\*'
  // 15: *italic*
  r'|\*([^*\n]+)\*',
  caseSensitive: false,
);

String _normalizeNaddrUri(String raw) {
  final t = raw.trim();
  if (t.toLowerCase().startsWith('nostr:')) return t;
  return 'nostr:$t';
}

class _EarthlyRichTextState extends State<EarthlyRichText> {
  final List<TapGestureRecognizer> _recognizers = [];

  @override
  void initState() {
    super.initState();
    unawaited(_resolveMissingRefs());
  }

  @override
  void didUpdateWidget(covariant EarthlyRichText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.text != widget.text) {
      unawaited(_resolveMissingRefs());
    }
  }

  @override
  void dispose() {
    _clearRecognizers();
    super.dispose();
  }

  void _clearRecognizers() {
    for (final r in _recognizers) {
      r.dispose();
    }
    _recognizers.clear();
  }

  DecodedNaddrDto? _lookupDecoded(String rawToken) {
    final norm = _normalizeNaddrUri(rawToken);
    return widget.preDecodedRefs[rawToken] ??
        widget.preDecodedRefs[norm] ??
        EarthlyRichText._naddrCache[norm];
  }

  Future<void> _resolveMissingRefs() async {
    final naddrTargets = <String>{};
    for (final m in _bareNaddrScanRe.allMatches(widget.text)) {
      final norm = _normalizeNaddrUri(m.group(0)!);
      if (!widget.preDecodedRefs.containsKey(norm) &&
          !EarthlyRichText._naddrCache.containsKey(norm)) {
        naddrTargets.add(norm);
      }
    }
    final npubTargets = <String>{};
    for (final m in _bareNpubScanRe.allMatches(widget.text)) {
      final token = m.group(0)!;
      if (!EarthlyRichText._npubHexCache.containsKey(token)) {
        npubTargets.add(token);
      }
    }
    if (naddrTargets.isEmpty && npubTargets.isEmpty) return;

    try {
      await RustBridge.ensureInitialized();
      var changed = false;
      for (final uri in naddrTargets) {
        final decoded = await decodeNaddrCoordinate(naddrUri: uri);
        if (decoded != null) {
          EarthlyRichText._naddrCache[uri] = decoded;
          changed = true;
        }
      }
      for (final uri in npubTargets) {
        final hex = await decodeNpubToHex(pubkeyOrNpub: uri);
        if (hex != null) {
          EarthlyRichText._npubHexCache[uri] = hex;
          changed = true;
        }
      }
      if (changed && mounted) setState(() {});
    } catch (_) {
      // Pure widget tests without the Rust dylib gracefully skip FFI decoding.
    }
  }

  void _handleNaddrTap(String rawUri, EarthlyReferenceScope? scope) {
    final norm = _normalizeNaddrUri(rawUri);
    final decoded = _lookupDecoded(norm);
    if (decoded != null && widget.onActivateDecodedNaddr != null) {
      widget.onActivateDecodedNaddr!(decoded);
      return;
    }
    if (widget.onActivateRawNaddr != null) {
      widget.onActivateRawNaddr!(norm);
      return;
    }
    if (scope != null) {
      unawaited(scope.onOpenNaddr(norm));
      return;
    }
    Clipboard.setData(ClipboardData(text: norm));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Copied nostr:naddr1… reference')),
    );
  }

  void _handleGeoTap(
    double lat,
    double lon,
    String label,
    EarthlyReferenceScope? scope,
  ) {
    if (widget.onActivateGeo != null) {
      widget.onActivateGeo!(lat, lon, label);
      return;
    }
    if (scope != null) {
      scope.onOpenGeo(lat, lon, label);
      return;
    }
    Clipboard.setData(ClipboardData(text: 'geo:$lat,$lon'));
  }

  void _handlePersonTap(String rawUri, EarthlyReferenceScope? scope) {
    final hex = EarthlyRichText._npubHexCache[rawUri] ??
        rawUri.replaceFirst(RegExp(r'^nostr:', caseSensitive: false), '');
    if (widget.onActivatePerson != null) {
      widget.onActivatePerson!(hex);
      return;
    }
    if (scope != null) {
      scope.onOpenPerson(hex);
      return;
    }
    Clipboard.setData(ClipboardData(text: rawUri));
  }

  void _handleUrlTap(String url, EarthlyReferenceScope? scope) {
    if (widget.onActivateUrl != null) {
      widget.onActivateUrl!(url);
      return;
    }
    if (scope?.onOpenUrl != null) {
      scope!.onOpenUrl!(url);
      return;
    }
    Clipboard.setData(ClipboardData(text: url));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Copied link: $url')),
    );
  }

  IconData _iconForDecoded(DecodedNaddrDto? decoded) {
    if (decoded == null) return Icons.layers_outlined;
    if (decoded.featureId != null && decoded.featureId!.isNotEmpty) {
      return Icons.push_pin_outlined;
    }
    return switch (decoded.kind) {
      37520 => Icons.auto_stories_outlined,
      37518 => Icons.public,
      37522 => Icons.visibility_outlined,
      37521 => Icons.sensors,
      _ => Icons.layers_outlined,
    };
  }

  Color _colorForDecoded(DecodedNaddrDto? decoded, ThemeData theme) {
    if (decoded == null) return theme.colorScheme.primary;
    return switch (decoded.kind) {
      37518 => EarthlyColors.commentGreen,
      37520 => EarthlyColors.infoCyan,
      _ => theme.colorScheme.primary,
    };
  }

  String _labelForNaddr(
    String rawUri, {
    String? explicitLabel,
    EarthlyReferenceScope? scope,
  }) {
    final cleanLabel = explicitLabel?.trim();
    if (cleanLabel != null &&
        cleanLabel.isNotEmpty &&
        !RegExp(r'^(?:nostr:)?naddr1', caseSensitive: false)
            .hasMatch(cleanLabel)) {
      return cleanLabel;
    }
    final decoded = _lookupDecoded(rawUri);
    if (decoded != null) {
      final fromWidget = widget.titleResolver?.call(decoded);
      if (fromWidget != null && fromWidget.isNotEmpty) return fromWidget;
      final fromScope = scope?.resolveNaddrTitle(decoded);
      if (fromScope != null && fromScope.isNotEmpty) return fromScope;
      final dTag = decoded.dTag.trim();
      if (dTag.isNotEmpty) {
        return decoded.featureId != null
            ? '$dTag #${decoded.featureId}'
            : dTag;
      }
    }
    final clean =
        rawUri.replaceFirst(RegExp(r'^nostr:', caseSensitive: false), '');
    return clean.length > 16
        ? '${clean.substring(0, 10)}…${clean.substring(clean.length - 4)}'
        : clean;
  }

  List<InlineSpan> _parseInline(
    String line,
    ThemeData theme,
    EarthlyReferenceScope? scope,
  ) {
    final spans = <InlineSpan>[];
    var cursor = 0;

    for (final m in _inlineTokenRe.allMatches(line)) {
      if (m.start > cursor) {
        spans.add(TextSpan(text: line.substring(cursor, m.start)));
      }

      if (m.group(1) != null && m.group(2) != null) {
        // [Label](nostr:naddr1...)
        final label = m.group(1)!;
        final uri = m.group(2)!;
        final decoded = _lookupDecoded(uri);
        spans.add(
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: _RichRefPill(
              icon: _iconForDecoded(decoded),
              label: _labelForNaddr(uri, explicitLabel: label, scope: scope),
              color: _colorForDecoded(decoded, theme),
              compact: widget.compact,
              onTap: () => _handleNaddrTap(uri, scope),
            ),
          ),
        );
      } else if (m.group(3) != null && m.group(4) != null) {
        // [Label](geo:lat,lon)
        final label = m.group(3)!.trim();
        final geoUri = m.group(4)!;
        final coords = geoUri.substring(4).split(',');
        final lat = double.tryParse(coords[0]);
        final lon = coords.length > 1 ? double.tryParse(coords[1]) : null;
        if (lat != null && lon != null) {
          spans.add(
            WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: _RichRefPill(
                icon: Icons.place,
                label: label.isNotEmpty
                    ? label
                    : '${lat.toStringAsFixed(4)}, ${lon.toStringAsFixed(4)}',
                color: EarthlyColors.destructive,
                compact: widget.compact,
                onTap: () => _handleGeoTap(lat, lon, label, scope),
              ),
            ),
          );
        } else {
          spans.add(TextSpan(text: m.group(0)));
        }
      } else if (m.group(5) != null && m.group(6) != null) {
        // [Label](nostr:npub1...)
        final label = m.group(5)!.trim();
        final uri = m.group(6)!;
        spans.add(
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: _RichRefPill(
              icon: Icons.person_outline,
              label: label.startsWith('@') ? label : '@$label',
              color: EarthlyColors.infoCyan,
              compact: widget.compact,
              onTap: () => _handlePersonTap(uri, scope),
            ),
          ),
        );
      } else if (m.group(7) != null && m.group(8) != null) {
        // [Label](https://...)
        final label = m.group(7)!.trim();
        final url = m.group(8)!.trim();
        final rec = TapGestureRecognizer()
          ..onTap = () => _handleUrlTap(url, scope);
        _recognizers.add(rec);
        spans.add(
          TextSpan(
            text: label,
            recognizer: rec,
            style: const TextStyle(
              color: EarthlyColors.infoCyan,
              decoration: TextDecoration.underline,
              fontWeight: FontWeight.w600,
            ),
          ),
        );
      } else if (m.group(9) != null) {
        // Bare nostr:naddr1... or naddr1...
        final uri = m.group(9)!;
        final decoded = _lookupDecoded(uri);
        spans.add(
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: _RichRefPill(
              icon: _iconForDecoded(decoded),
              label: _labelForNaddr(uri, scope: scope),
              color: _colorForDecoded(decoded, theme),
              compact: widget.compact,
              onTap: () => _handleNaddrTap(uri, scope),
            ),
          ),
        );
      } else if (m.group(10) != null) {
        // Bare nostr:npub1... / nostr:nprofile1...
        final uri = m.group(10)!;
        final hex = EarthlyRichText._npubHexCache[uri];
        final resolvedName = hex != null ? scope?.resolvePersonLabel(hex) : null;
        final clean =
            uri.replaceFirst(RegExp(r'^nostr:', caseSensitive: false), '');
        final label = resolvedName != null && resolvedName.isNotEmpty
            ? '@$resolvedName'
            : (clean.length > 14 ? '@${clean.substring(0, 12)}…' : '@$clean');
        spans.add(
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: _RichRefPill(
              icon: Icons.person_outline,
              label: label,
              color: EarthlyColors.infoCyan,
              compact: widget.compact,
              onTap: () => _handlePersonTap(uri, scope),
            ),
          ),
        );
      } else if (m.group(11) != null) {
        // Bare geo:lat,lon
        final token = m.group(11)!;
        final coords = token.substring(4).split(',');
        final lat = double.tryParse(coords[0]);
        final lon = coords.length > 1 ? double.tryParse(coords[1]) : null;
        if (lat != null && lon != null) {
          final label = '${lat.toStringAsFixed(4)}, ${lon.toStringAsFixed(4)}';
          spans.add(
            WidgetSpan(
              alignment: PlaceholderAlignment.middle,
              child: _RichRefPill(
                icon: Icons.place,
                label: label,
                color: EarthlyColors.destructive,
                compact: widget.compact,
                onTap: () => _handleGeoTap(lat, lon, label, scope),
              ),
            ),
          );
        } else {
          spans.add(TextSpan(text: token));
        }
      } else if (m.group(12) != null) {
        // Bare https://... (trim trailing punctuation)
        final rawUrl = m.group(12)!;
        final cleanUrl = rawUrl.replaceFirst(RegExp(r'[.,;:!?)]+$'), '');
        final suffix = rawUrl.substring(cleanUrl.length);
        final rec = TapGestureRecognizer()
          ..onTap = () => _handleUrlTap(cleanUrl, scope);
        _recognizers.add(rec);
        spans.add(
          TextSpan(
            text: cleanUrl,
            recognizer: rec,
            style: const TextStyle(
              color: EarthlyColors.infoCyan,
              decoration: TextDecoration.underline,
            ),
          ),
        );
        if (suffix.isNotEmpty) {
          spans.add(TextSpan(text: suffix));
        }
      } else if (m.group(13) != null) {
        // `inline code`
        spans.add(
          TextSpan(
            text: m.group(13),
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: (widget.baseStyle?.fontSize ?? 13.5) - 1,
              backgroundColor:
                  theme.colorScheme.onSurface.withValues(alpha: 0.08),
            ),
          ),
        );
      } else if (m.group(14) != null) {
        // **bold**
        spans.add(
          TextSpan(
            text: m.group(14),
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        );
      } else if (m.group(15) != null) {
        // *italic*
        spans.add(
          TextSpan(
            text: m.group(15),
            style: const TextStyle(fontStyle: FontStyle.italic),
          ),
        );
      }
      cursor = m.end;
    }

    if (cursor < line.length) {
      spans.add(TextSpan(text: line.substring(cursor)));
    }
    return spans;
  }

  List<String> _splitTableRow(String line) {
    var trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
    if (trimmed.endsWith('|')) {
      trimmed = trimmed.substring(0, trimmed.length - 1);
    }
    return trimmed.split('|').map((c) => c.trim()).toList(growable: false);
  }

  List<TextAlign> _parseAlignments(String sepLine) {
    return _splitTableRow(sepLine).map((cell) {
      final left = cell.startsWith(':');
      final right = cell.endsWith(':');
      if (left && right) return TextAlign.center;
      if (right) return TextAlign.right;
      return TextAlign.left;
    }).toList(growable: false);
  }

  Widget _buildTable(
    List<String> headerCells,
    List<TextAlign> alignments,
    List<List<String>> rows,
    ThemeData theme,
    TextStyle bodyStyle,
    EarthlyReferenceScope? scope,
  ) {
    final colCount = headerCells.length;
    TextAlign alignFor(int idx) =>
        idx < alignments.length ? alignments[idx] : TextAlign.left;

    Widget buildCell(
      String content,
      int colIdx, {
      required bool isHeader,
    }) {
      return Padding(
        padding: EdgeInsets.symmetric(
          horizontal: widget.compact ? 8 : 10,
          vertical: widget.compact ? 6 : 8,
        ),
        child: Text.rich(
          TextSpan(
            style: isHeader
                ? bodyStyle.copyWith(
                    fontWeight: FontWeight.w800,
                    fontSize: (bodyStyle.fontSize ?? 13.5) - 0.5,
                  )
                : bodyStyle.copyWith(
                    fontSize: (bodyStyle.fontSize ?? 13.5) - 0.5,
                  ),
            children: _parseInline(content, theme, scope),
          ),
          textAlign: alignFor(colIdx),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: Container(
          decoration: BoxDecoration(
            border: Border.all(color: theme.dividerColor),
            borderRadius: BorderRadius.circular(10),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Table(
              defaultColumnWidth: const IntrinsicColumnWidth(),
              border: TableBorder.symmetric(
                inside: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.7),
                ),
              ),
              children: [
                TableRow(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                  ),
                  children: [
                    for (var c = 0; c < colCount; c++)
                      buildCell(headerCells[c], c, isHeader: true),
                  ],
                ),
                for (var r = 0; r < rows.length; r++)
                  TableRow(
                    decoration: BoxDecoration(
                      color: r.isOdd
                          ? theme.colorScheme.onSurface.withValues(alpha: 0.025)
                          : Colors.transparent,
                    ),
                    children: [
                      for (var c = 0; c < colCount; c++)
                        buildCell(
                          c < rows[r].length ? rows[r][c] : '',
                          c,
                          isHeader: false,
                        ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    _clearRecognizers();
    final theme = Theme.of(context);
    final scope = EarthlyReferenceScope.maybeOf(context);
    final bodyStyle = widget.baseStyle ??
        (widget.compact
            ? theme.textTheme.bodySmall?.copyWith(height: 1.4)
            : theme.textTheme.bodyMedium?.copyWith(height: 1.48)) ??
        const TextStyle(fontSize: 13.5, height: 1.45);

    final lines = widget.text.replaceAll('\r\n', '\n').split('\n');
    final widgets = <Widget>[];

    var i = 0;
    while (i < lines.length) {
      final raw = lines[i];
      final line = raw.trim();

      if (line.isEmpty) {
        if (widgets.isNotEmpty) {
          widgets.add(SizedBox(height: widget.compact ? 4 : 6));
        }
        i += 1;
        continue;
      }

      // Fenced code block ```...```
      if (line.startsWith('```')) {
        final codeLines = <String>[];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.add(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        widgets.add(
          Container(
            width: double.infinity,
            margin: const EdgeInsets.symmetric(vertical: 6),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: theme.dividerColor),
            ),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Text(
                codeLines.join('\n'),
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  height: 1.4,
                ),
              ),
            ),
          ),
        );
        continue;
      }

      // GFM Pipe Table (header + separator + data rows)
      if (line.contains('|') &&
          i + 1 < lines.length &&
          _tableSepRe.hasMatch(lines[i + 1])) {
        final headerCells = _splitTableRow(line);
        final alignments = _parseAlignments(lines[i + 1]);
        final dataRows = <List<String>>[];
        i += 2;
        while (i < lines.length &&
            lines[i].trim().isNotEmpty &&
            lines[i].contains('|')) {
          dataRows.add(_splitTableRow(lines[i]));
          i += 1;
        }
        widgets.add(
          _buildTable(headerCells, alignments, dataRows, theme, bodyStyle, scope),
        );
        continue;
      }

      // Headings
      if (line.startsWith('### ')) {
        widgets.add(
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 3),
            child: Text.rich(
              TextSpan(
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
                children: _parseInline(line.substring(4), theme, scope),
              ),
            ),
          ),
        );
        i += 1;
        continue;
      }
      if (line.startsWith('## ')) {
        widgets.add(
          Padding(
            padding: const EdgeInsets.only(top: 10, bottom: 4),
            child: Text.rich(
              TextSpan(
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
                children: _parseInline(line.substring(3), theme, scope),
              ),
            ),
          ),
        );
        i += 1;
        continue;
      }
      if (line.startsWith('# ')) {
        widgets.add(
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 6),
            child: Text.rich(
              TextSpan(
                style: (widget.compact
                        ? theme.textTheme.titleSmall
                        : theme.textTheme.titleLarge)
                    ?.copyWith(fontWeight: FontWeight.w800),
                children: _parseInline(line.substring(2), theme, scope),
              ),
            ),
          ),
        );
        i += 1;
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        widgets.add(
          Container(
            margin: const EdgeInsets.symmetric(vertical: 4),
            padding: const EdgeInsets.fromLTRB(10, 4, 8, 4),
            decoration: const BoxDecoration(
              border: Border(
                left: BorderSide(color: EarthlyColors.amber, width: 3),
              ),
            ),
            child: Text.rich(
              TextSpan(
                style: bodyStyle.copyWith(fontStyle: FontStyle.italic),
                children: _parseInline(line.substring(2), theme, scope),
              ),
            ),
          ),
        );
        i += 1;
        continue;
      }

      // Markdown Images `![alt](https://...)`
      final imgs = _markdownImageRe.allMatches(line).toList();
      if (imgs.isNotEmpty) {
        for (final m in imgs) {
          final alt = (m.group(1) ?? '').trim();
          final url = (m.group(2) ?? '').trim();
          final titleCap = (m.group(3) ?? '').trim();
          final caption = titleCap.isNotEmpty ? titleCap : alt;
          if (url.isEmpty) continue;
          widgets.add(
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  GestureDetector(
                    onTap: () => showEarthlyPhotoLightbox(
                      context,
                      url: url,
                      caption: caption,
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxHeight: widget.compact ? 160 : 240,
                        ),
                        child: EarthlyNetworkImage(
                          url: url,
                          fit: BoxFit.cover,
                          fallback: const SizedBox.shrink(),
                        ),
                      ),
                    ),
                  ),
                  if (caption.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      caption,
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontSize: 11.5,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        }
        final rest = line.replaceAll(_markdownImageRe, '').trim();
        i += 1;
        if (rest.isEmpty) continue;
        widgets.add(
          Padding(
            padding: EdgeInsets.only(bottom: widget.compact ? 3 : 5),
            child: Text.rich(
              TextSpan(
                style: bodyStyle,
                children: _parseInline(rest, theme, scope),
              ),
            ),
          ),
        );
        continue;
      }

      // Bullet / ordered list items
      final bulletMatch = RegExp(r'^([-*]|\d+\.)\s+(.*)$').firstMatch(line);
      if (bulletMatch != null) {
        final marker =
            bulletMatch.group(1)!.endsWith('.') ? bulletMatch.group(1)! : '•';
        final itemBody = bulletMatch.group(2)!;
        widgets.add(
          Padding(
            padding: EdgeInsets.only(
              left: 4,
              bottom: widget.compact ? 3 : 4,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: marker.length > 1 ? 22 : 14,
                  child: Text(
                    marker,
                    style: bodyStyle.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      style: bodyStyle,
                      children: _parseInline(itemBody, theme, scope),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
        i += 1;
        continue;
      }

      // Standard paragraph line
      widgets.add(
        Padding(
          padding: EdgeInsets.only(bottom: widget.compact ? 3 : 5),
          child: Text.rich(
            TextSpan(
              style: bodyStyle,
              children: _parseInline(line, theme, scope),
            ),
          ),
        ),
      );
      i += 1;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: widgets,
    );
  }
}

class _RichRefPill extends StatelessWidget {
  const _RichRefPill({
    required this.icon,
    required this.label,
    required this.color,
    required this.compact,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 5 : 7,
          vertical: compact ? 1.5 : 2.5,
        ),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.13),
          borderRadius: BorderRadius.circular(7),
          border: Border.all(color: color.withValues(alpha: 0.62)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: compact ? 11 : 12.5, color: color),
            const SizedBox(width: 4),
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: compact ? 150 : 210),
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: compact ? 11 : 11.8,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
