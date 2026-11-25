import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../src/rust/api/nostr_client.dart';

enum AtlasSchemaFieldType { text, number, integer, boolean, enumType }

enum AtlasSchemaFilterMode { off, warn, strict }

@immutable
class AtlasSchemaRow {
  const AtlasSchemaRow({
    required this.name,
    required this.type,
    this.required = false,
    this.allowedValues = const <String>[],
  });

  final String name;
  final AtlasSchemaFieldType type;
  final bool required;
  final List<String> allowedValues;

  AtlasSchemaRow copyWith({
    String? name,
    AtlasSchemaFieldType? type,
    bool? required,
    List<String>? allowedValues,
  }) =>
      AtlasSchemaRow(
        name: name ?? this.name,
        type: type ?? this.type,
        required: required ?? this.required,
        allowedValues: allowedValues ?? this.allowedValues,
      );
}

const String earthlyDraft202012Dialect =
    'https://json-schema.org/draft/2020-12/schema';

/// Compiles visual builder field rules and allowed GeoJSON geometry types into
/// a canonical draft-2020-12 JSON Schema matching Web `compileBuilderSchema`.
String compileAtlasSchemaJson(
  List<AtlasSchemaRow> rows,
  List<String> allowedGeometryTypes,
) {
  final properties = <String, dynamic>{};
  final required = <String>[];

  for (final row in rows) {
    final key = row.name.trim();
    if (key.isEmpty) continue;
    properties[key] = switch (row.type) {
      AtlasSchemaFieldType.text => <String, dynamic>{'type': 'string'},
      AtlasSchemaFieldType.number => <String, dynamic>{'type': 'number'},
      AtlasSchemaFieldType.integer => <String, dynamic>{'type': 'integer'},
      AtlasSchemaFieldType.boolean => <String, dynamic>{'type': 'boolean'},
      AtlasSchemaFieldType.enumType => <String, dynamic>{
          'enum': row.allowedValues
              .map((v) => v.trim())
              .where((v) => v.isNotEmpty)
              .toList(growable: false),
        },
    };
    if (row.required) required.add(key);
  }

  if (allowedGeometryTypes.isNotEmpty) {
    properties['geometry'] = <String, dynamic>{
      'type': 'object',
      'properties': <String, dynamic>{
        'type': <String, dynamic>{
          'enum': allowedGeometryTypes,
        },
      },
    };
  }

  return jsonEncode(<String, dynamic>{
    r'$schema': earthlyDraft202012Dialect,
    'type': 'object',
    'properties': properties,
    'required': required,
    'additionalProperties': true,
  });
}

List<AtlasSchemaRow> decodeAtlasSchemaRows(String? schemaJson) {
  if (schemaJson == null || schemaJson.trim().isEmpty) return const [];
  try {
    final decoded = jsonDecode(schemaJson);
    if (decoded is! Map<String, dynamic>) return const [];
    final props = decoded['properties'];
    if (props is! Map) return const [];
    final requiredSet = <String>{
      if (decoded['required'] is List)
        for (final r in decoded['required'] as List)
          if (r is String) r,
    };
    final rows = <AtlasSchemaRow>[];
    for (final entry in props.entries) {
      final key = entry.key.toString();
      if (key == 'geometry') continue;
      final def = entry.value;
      if (def is! Map) continue;
      if (def['enum'] is List) {
        rows.add(
          AtlasSchemaRow(
            name: key,
            type: AtlasSchemaFieldType.enumType,
            required: requiredSet.contains(key),
            allowedValues: (def['enum'] as List)
                .map((e) => e.toString())
                .toList(growable: false),
          ),
        );
        continue;
      }
      final t = switch (def['type']?.toString()) {
        'string' => AtlasSchemaFieldType.text,
        'number' => AtlasSchemaFieldType.number,
        'integer' => AtlasSchemaFieldType.integer,
        'boolean' => AtlasSchemaFieldType.boolean,
        _ => null,
      };
      if (t != null) {
        rows.add(
          AtlasSchemaRow(
            name: key,
            type: t,
            required: requiredSet.contains(key),
          ),
        );
      }
    }
    return rows;
  } catch (_) {
    return const [];
  }
}

List<String> decodeAtlasAllowedGeometries(String? schemaJson) {
  if (schemaJson == null || schemaJson.trim().isEmpty) return const [];
  try {
    final decoded = jsonDecode(schemaJson);
    if (decoded is! Map) return const [];
    final props = decoded['properties'];
    if (props is! Map) return const [];
    final geometry = props['geometry'];
    if (geometry is! Map) return const [];
    final geomProps = geometry['properties'];
    if (geomProps is! Map) return const [];
    final typeDef = geomProps['type'];
    if (typeDef is! Map) return const [];
    final enumList = typeDef['enum'];
    if (enumList is! List) return const [];
    return enumList.map((e) => e.toString()).toList(growable: false);
  } catch (_) {
    return const [];
  }
}

/// Evaluates whether a Community Contribution map conforms to an Atlas's
/// draft-2020-12 JSON Schema under `off`, `warn`, or `strict` filter mode.
({bool show, String? reason}) evaluateMapAgainstSchema({
  required AtlasSchemaFilterMode mode,
  required MapSummaryDto map,
  required String? schemaJson,
  String? publishedHash,
  bool hashVerified = true,
}) {
  if (mode == AtlasSchemaFilterMode.off) {
    return (show: true, reason: null);
  }
  if (schemaJson == null || schemaJson.trim().isEmpty) {
    return (show: true, reason: null);
  }
  if (publishedHash != null &&
      publishedHash.trim().isNotEmpty &&
      !hashVerified) {
    return (
      show: true,
      reason: 'Schema could not be verified (schema-hash mismatch)',
    );
  }

  final rows = decodeAtlasSchemaRows(schemaJson);
  final allowedGeoms = decodeAtlasAllowedGeometries(schemaJson);
  if (rows.isEmpty && allowedGeoms.isEmpty) {
    return (show: true, reason: null);
  }

  final errors = <String>[];
  try {
    final fc = jsonDecode(map.geojson);
    final features = (fc is Map && fc['features'] is List)
        ? fc['features'] as List
        : const [];
    if (features.isEmpty) {
      errors.add('map has no features to validate');
    }
    for (final rawFeat in features) {
      if (rawFeat is! Map) continue;
      final geomType = rawFeat['geometry'] is Map
          ? (rawFeat['geometry'] as Map)['type']?.toString()
          : null;
      if (allowedGeoms.isNotEmpty &&
          geomType != null &&
          !allowedGeoms.contains(geomType)) {
        errors.add('geometry `$geomType` not allowed');
      }
      final props = rawFeat['properties'] is Map
          ? rawFeat['properties'] as Map
          : const <dynamic, dynamic>{};
      for (final row in rows) {
        final hasVal = props.containsKey(row.name) && props[row.name] != null;
        final val = props[row.name];
        if (row.required &&
            (!hasVal || (val is String && val.trim().isEmpty))) {
          errors.add('missing required `${row.name}`');
          continue;
        }
        if (!hasVal) continue;
        switch (row.type) {
          case AtlasSchemaFieldType.text:
            if (val is! String) errors.add('`${row.name}` must be text');
          case AtlasSchemaFieldType.number:
            if (val is! num) errors.add('`${row.name}` must be a number');
          case AtlasSchemaFieldType.integer:
            if (val is! int) errors.add('`${row.name}` must be an integer');
          case AtlasSchemaFieldType.boolean:
            if (val is! bool) errors.add('`${row.name}` must be boolean');
          case AtlasSchemaFieldType.enumType:
            final s = val.toString();
            if (!row.allowedValues.contains(s)) {
              errors.add('`${row.name}` value `$s` not allowed');
            }
        }
      }
    }
  } catch (_) {
    errors.add('invalid GeoJSON content');
  }

  if (errors.isEmpty) return (show: true, reason: null);
  final summary = errors.toSet().take(3).join('; ');
  return (
    show: mode != AtlasSchemaFilterMode.strict,
    reason: summary,
  );
}
