import 'dart:convert';

import 'package:flutter/foundation.dart';

/// Camera target embedded in a Story's `presentation.initialView` or an
/// `earthly-view` Markdown fence (`MapPresentationCameraV1`).
@immutable
class StoryCameraTarget {
  const StoryCameraTarget({
    required this.lon,
    required this.lat,
    required this.zoom,
    this.bearing = 0,
    this.pitch = 0,
  });

  final double lon;
  final double lat;
  final double zoom;
  final double bearing;
  final double pitch;

  static StoryCameraTarget? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final center = raw['center'];
    final zoom = raw['zoom'];
    if (center is! List || center.length < 2 || zoom is! num) return null;
    final lon = center[0];
    final lat = center[1];
    if (lon is! num || lat is! num) return null;
    if (!lon.isFinite || !lat.isFinite || !zoom.isFinite) return null;
    return StoryCameraTarget(
      lon: lon.toDouble(),
      lat: lat.toDouble(),
      zoom: zoom.toDouble().clamp(0.5, 22.0),
      bearing: (raw['bearing'] is num) ? (raw['bearing'] as num).toDouble() : 0,
      pitch: (raw['pitch'] is num) ? (raw['pitch'] as num).toDouble() : 0,
    );
  }
}

/// Optional style override from `MapPresentationLayerV1.style`.
@immutable
class StoryLayerStyleOverride {
  const StoryLayerStyleOverride({
    this.color,
    this.fillColor,
    this.strokeColor,
    this.fillOpacity,
    this.strokeWidth,
    this.radius,
  });

  final String? color;
  final String? fillColor;
  final String? strokeColor;
  final double? fillOpacity;
  final double? strokeWidth;
  final double? radius;

  static StoryLayerStyleOverride? tryParse(Object? raw) {
    if (raw is! Map) return null;
    return StoryLayerStyleOverride(
      color: raw['color'] as String?,
      fillColor: raw['fillColor'] as String?,
      strokeColor: raw['strokeColor'] as String?,
      fillOpacity: (raw['fillOpacity'] is num)
          ? (raw['fillOpacity'] as num).toDouble()
          : null,
      strokeWidth: (raw['strokeWidth'] is num)
          ? (raw['strokeWidth'] as num).toDouble()
          : null,
      radius:
          (raw['radius'] is num) ? (raw['radius'] as num).toDouble() : null,
    );
  }

  StoryLayerStyleOverride merge(StoryLayerStyleOverride? patch) {
    if (patch == null) return this;
    return StoryLayerStyleOverride(
      color: patch.color ?? color,
      fillColor: patch.fillColor ?? fillColor,
      strokeColor: patch.strokeColor ?? strokeColor,
      fillOpacity: patch.fillOpacity ?? fillOpacity,
      strokeWidth: patch.strokeWidth ?? strokeWidth,
      radius: patch.radius ?? radius,
    );
  }
}

/// A single layer entry in `MapPresentationV1.layers`.
@immutable
class StoryPresentationLayer {
  const StoryPresentationLayer({
    required this.id,
    required this.sourceAddress,
    required this.visible,
    this.featureIds,
    this.opacityMultiplier = 1.0,
    this.style,
  });

  final String id;
  final String sourceAddress;
  final bool visible;
  final Set<String>? featureIds;
  final double opacityMultiplier;
  final StoryLayerStyleOverride? style;

  StoryPresentationLayer copyWith({
    bool? visible,
    double? opacityMultiplier,
    StoryLayerStyleOverride? style,
  }) =>
      StoryPresentationLayer(
        id: id,
        sourceAddress: sourceAddress,
        visible: visible ?? this.visible,
        featureIds: featureIds,
        opacityMultiplier: opacityMultiplier ?? this.opacityMultiplier,
        style: style ?? this.style,
      );
}

@immutable
class StoryLayerPatch {
  const StoryLayerPatch({
    this.visible,
    this.opacityMultiplier,
    this.style,
  });

  final bool? visible;
  final double? opacityMultiplier;
  final StoryLayerStyleOverride? style;
}

/// A parsed ```` ```earthly-view ```` block inside a Story's Markdown body.
@immutable
class StoryViewStep {
  const StoryViewStep({
    required this.id,
    required this.title,
    this.caption,
    this.display = 'cue',
    this.camera,
    this.layerPatches = const {},
  });

  final String id;
  final String title;
  final String? caption;
  final String display;
  final StoryCameraTarget? camera;
  final Map<String, StoryLayerPatch> layerPatches;
}

/// Cumulative state after applying a Story's initial presentation + views[0..i].
@immutable
class EffectiveStoryView {
  const EffectiveStoryView({
    required this.layers,
    this.camera,
    this.step,
  });

  final List<StoryPresentationLayer> layers;
  final StoryCameraTarget? camera;
  final StoryViewStep? step;
}

/// An inline spatial reference extracted from Story Markdown (`SPEC.md` §2.4).
enum StoryInlineRefKind { naddr, geoCoord }

@immutable
class StoryInlineRef {
  const StoryInlineRef.naddr({
    required this.rawToken,
    required this.naddrUri,
  })  : kind = StoryInlineRefKind.naddr,
        lat = null,
        lon = null;

  const StoryInlineRef.geo({
    required this.rawToken,
    required this.lat,
    required this.lon,
  })  : kind = StoryInlineRefKind.geoCoord,
        naddrUri = null;

  final StoryInlineRefKind kind;
  final String rawToken;
  final String? naddrUri;
  final double? lat;
  final double? lon;
}

/// Structured segment of a Story's Markdown body so the reader renders clean
/// prose interleaved with interactive `earthly-view` camera cues.
sealed class StoryBodySegment {
  const StoryBodySegment();
}

class StoryMarkdownTextSegment extends StoryBodySegment {
  const StoryMarkdownTextSegment(this.text);
  final String text;
}

class StoryViewCardSegment extends StoryBodySegment {
  const StoryViewCardSegment({required this.viewIndex, required this.step});
  final int viewIndex;
  final StoryViewStep step;
}

/// Complete parsed Story presentation + Markdown views + inline references.
@immutable
class ParsedStoryDocument {
  const ParsedStoryDocument({
    required this.initialView,
    required this.baseLayers,
    required this.viewSnapshots,
    required this.segments,
    required this.inlineRefs,
  });

  final StoryCameraTarget? initialView;
  final List<StoryPresentationLayer> baseLayers;
  final List<EffectiveStoryView> viewSnapshots;
  final List<StoryBodySegment> segments;
  final List<StoryInlineRef> inlineRefs;

  /// Every `37515:<pubkey>:<d>` dataset referenced by presentation layers.
  Set<String> get presentationMapAddresses =>
      baseLayers.map((l) => l.sourceAddress).toSet();
}

final RegExp _earthlyViewFenceRe = RegExp(
  r'```earthly-view[ \t]*\r?\n([\s\S]*?)```',
  multiLine: true,
);

final RegExp _naddrRefRe = RegExp(
  r'nostr:(naddr1[023456789acdefghjklmnpqrstuvwxyz]+(?:#[A-Za-z0-9_.\-%]+)?)',
  caseSensitive: false,
);

final RegExp _geoUriRe = RegExp(
  r'\bgeo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\b',
  caseSensitive: false,
);

/// Parses a Story's optional `presentation` JSON and Markdown body into base
/// presentation layers, cumulative `earthly-view` snapshots, body segments,
/// and inline `nostr:naddr1...` / `geo:lat,lon` spatial references.
ParsedStoryDocument parseStoryDocument({
  required String markdown,
  String? presentationJson,
}) {
  StoryCameraTarget? initialView;
  final baseLayers = <StoryPresentationLayer>[];

  if (presentationJson != null && presentationJson.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(presentationJson);
      if (decoded is Map<String, dynamic>) {
        initialView = StoryCameraTarget.tryParse(decoded['initialView']);
        final rawLayers = decoded['layers'];
        if (rawLayers is List) {
          for (final item in rawLayers) {
            if (item is! Map) continue;
            final id = item['id'];
            final source = item['source'];
            if (id is! String || id.isEmpty) continue;
            if (source is! String || !source.startsWith('37515:')) continue;
            final visible = item['visible'] is bool ? item['visible'] as bool : true;
            final opacity = (item['opacityMultiplier'] is num)
                ? (item['opacityMultiplier'] as num).toDouble().clamp(0.0, 1.0)
                : 1.0;
            Set<String>? featureIds;
            if (item['featureIds'] is List) {
              featureIds = (item['featureIds'] as List)
                  .whereType<String>()
                  .toSet();
            }
            baseLayers.add(
              StoryPresentationLayer(
                id: id,
                sourceAddress: source,
                visible: visible,
                featureIds: featureIds,
                opacityMultiplier: opacity,
                style: StoryLayerStyleOverride.tryParse(item['style']),
              ),
            );
          }
        }
      }
    } catch (_) {
      // Defensive parse: invalid presentation JSON never blocks Story reading.
    }
  }

  final segments = <StoryBodySegment>[];
  final steps = <StoryViewStep>[];
  var cursor = 0;

  for (final match in _earthlyViewFenceRe.allMatches(markdown)) {
    if (match.start > cursor) {
      final before = markdown.substring(cursor, match.start).trim();
      if (before.isNotEmpty) {
        segments.add(StoryMarkdownTextSegment(before));
      }
    }
    final payload = match.group(1)?.trim() ?? '';
    final step = _tryParseViewStep(payload, steps.length);
    if (step != null) {
      final viewIdx = steps.length;
      steps.add(step);
      segments.add(StoryViewCardSegment(viewIndex: viewIdx, step: step));
    }
    cursor = match.end;
  }
  if (cursor < markdown.length) {
    final tail = markdown.substring(cursor).trim();
    if (tail.isNotEmpty) {
      segments.add(StoryMarkdownTextSegment(tail));
    }
  }

  // Reduce cumulative view snapshots (mirrors src/lib/map-presentation/views.ts).
  final snapshots = <EffectiveStoryView>[];
  var currentLayers = List<StoryPresentationLayer>.of(baseLayers);
  var currentCamera = initialView;
  for (final step in steps) {
    currentCamera = step.camera ?? currentCamera;
    if (step.layerPatches.isNotEmpty) {
      currentLayers = currentLayers.map((layer) {
        final patch = step.layerPatches[layer.id];
        if (patch == null) return layer;
        return layer.copyWith(
          visible: patch.visible ?? layer.visible,
          opacityMultiplier: patch.opacityMultiplier ?? layer.opacityMultiplier,
          style: layer.style != null
              ? layer.style!.merge(patch.style)
              : patch.style,
        );
      }).toList(growable: false);
    }
    snapshots.add(
      EffectiveStoryView(
        layers: List<StoryPresentationLayer>.unmodifiable(currentLayers),
        camera: currentCamera,
        step: step,
      ),
    );
  }

  // Extract inline nostr:naddr1... and geo:lat,lon references across text segments.
  final inlineRefs = <StoryInlineRef>[];
  final seenTokens = <String>{};
  for (final seg in segments) {
    if (seg is! StoryMarkdownTextSegment) continue;
    for (final m in _naddrRefRe.allMatches(seg.text)) {
      final token = m.group(0)!;
      if (seenTokens.add(token)) {
        inlineRefs.add(StoryInlineRef.naddr(rawToken: token, naddrUri: token));
      }
    }
    for (final m in _geoUriRe.allMatches(seg.text)) {
      final token = m.group(0)!;
      final lat = double.tryParse(m.group(1) ?? '');
      final lon = double.tryParse(m.group(2) ?? '');
      if (lat != null &&
          lon != null &&
          lat >= -90 &&
          lat <= 90 &&
          lon >= -180 &&
          lon <= 180 &&
          seenTokens.add(token)) {
        inlineRefs.add(StoryInlineRef.geo(rawToken: token, lat: lat, lon: lon));
      }
    }
  }

  return ParsedStoryDocument(
    initialView: initialView,
    baseLayers: baseLayers,
    viewSnapshots: snapshots,
    segments: segments,
    inlineRefs: inlineRefs,
  );
}

StoryViewStep? _tryParseViewStep(String payload, int fallbackIndex) {
  try {
    final decoded = jsonDecode(payload);
    if (decoded is! Map<String, dynamic>) return null;
    final id = (decoded['id'] as String?)?.trim();
    final title = (decoded['title'] as String?)?.trim();
    final caption = (decoded['caption'] as String?)?.trim();
    final rawDisplay = (decoded['display'] as String?)?.trim().toLowerCase();
    final display = (rawDisplay == 'figure' || rawDisplay == 'both')
        ? rawDisplay!
        : 'cue';
    final camera = StoryCameraTarget.tryParse(decoded['camera']);
    final patches = <String, StoryLayerPatch>{};
    final rawLayers = decoded['layers'];
    if (rawLayers is Map) {
      for (final entry in rawLayers.entries) {
        final key = entry.key.toString();
        final val = entry.value;
        if (val is! Map) continue;
        patches[key] = StoryLayerPatch(
          visible: val['visible'] is bool ? val['visible'] as bool : null,
          opacityMultiplier: (val['opacityMultiplier'] is num)
              ? (val['opacityMultiplier'] as num).toDouble().clamp(0.0, 1.0)
              : null,
          style: StoryLayerStyleOverride.tryParse(val['style']),
        );
      }
    }
    return StoryViewStep(
      id: (id != null && id.isNotEmpty) ? id : 'view-${fallbackIndex + 1}',
      title: (title != null && title.isNotEmpty)
          ? title
          : 'View ${fallbackIndex + 1}',
      caption: (caption != null && caption.isNotEmpty) ? caption : null,
      display: display,
      camera: camera,
      layerPatches: patches,
    );
  } catch (_) {
    return null;
  }
}
