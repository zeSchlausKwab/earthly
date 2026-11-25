import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../runtime/rust_bridge.dart';
import '../src/rust/api/geo.dart';
import '../theme/earthly_theme.dart';
import 'map_drawer.dart';

/// Valhalla network routing & travel-time isochrones drawer: compute A→B
/// pedestrian/bicycle/car routes and multi-band reachability polygons via
/// pure-Rust `earthly-ffi`, preview metrics, and import directly to Working Draft.
class RoutingSheet extends StatefulWidget {
  const RoutingSheet({
    required this.mapCenter,
    required this.draftWaypoints,
    required this.onImportGeoJsonToDraft,
    required this.onClose,
    this.initialOrigin,
    this.routeOverride,
    this.isochroneOverride,
    super.key,
  });

  final Geographic mapCenter;
  final List<Geographic> draftWaypoints;
  final Geographic? initialOrigin;
  final void Function(String geojson, String summaryLabel) onImportGeoJsonToDraft;
  final Future<ValhallaRouteResultDto> Function({
    required List<LonLatPoint> waypoints,
    required String profile,
  })? routeOverride;
  final Future<ValhallaIsochroneResultDto> Function({
    required LonLatPoint origin,
    required String profile,
    required List<int> contoursMinutes,
  })? isochroneOverride;
  final VoidCallback onClose;

  @override
  State<RoutingSheet> createState() => _RoutingSheetState();
}

class _RoutingSheetState extends State<RoutingSheet>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);
  late final TextEditingController _wpInputController = TextEditingController();
  late final TextEditingController _isoLatController;
  late final TextEditingController _isoLonController;

  late final List<Geographic> _waypoints;
  String _profile = 'bicycle';
  final Set<int> _isoContours = <int>{5, 10, 15};
  bool _busy = false;
  String? _error;
  ValhallaRouteResultDto? _routeResult;
  ValhallaIsochroneResultDto? _isoResult;

  @override
  void initState() {
    super.initState();
    final origin = widget.initialOrigin ?? widget.mapCenter;
    _isoLatController =
        TextEditingController(text: origin.lat.toStringAsFixed(5));
    _isoLonController =
        TextEditingController(text: origin.lon.toStringAsFixed(5));
    _waypoints = <Geographic>[
      if (widget.initialOrigin != null) widget.initialOrigin!,
      for (final wp in widget.draftWaypoints) wp,
    ];
  }

  @override
  void dispose() {
    _tabs.dispose();
    _wpInputController.dispose();
    _isoLatController.dispose();
    _isoLonController.dispose();
    super.dispose();
  }

  void _addWaypointCoord(Geographic pt) {
    setState(() {
      _waypoints.add(pt);
      _error = null;
    });
  }

  void _addManualWaypoint() {
    final raw = _wpInputController.text.trim();
    final parts = raw.split(RegExp(r'[,;\s]+'));
    if (parts.length >= 2) {
      final lat = double.tryParse(parts[0]);
      final lon = double.tryParse(parts[1]);
      if (lat != null &&
          lon != null &&
          lat >= -90 &&
          lat <= 90 &&
          lon >= -180 &&
          lon <= 180) {
        _wpInputController.clear();
        _addWaypointCoord(Geographic(lon: lon, lat: lat));
        return;
      }
    }
    setState(() => _error = 'Enter coordinates as "lat, lon" (e.g. 48.2082, 16.3738)');
  }

  Future<void> _computeRoute() async {
    if (_waypoints.length < 2) {
      setState(() => _error = 'Add at least 2 waypoints to compute a route.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final pts = _waypoints
          .map((w) => LonLatPoint(lon: w.lon, lat: w.lat))
          .toList(growable: false);
      final res = widget.routeOverride != null
          ? await widget.routeOverride!(waypoints: pts, profile: _profile)
          : await (() async {
              await RustBridge.ensureInitialized();
              return geoValhallaRoute(waypoints: pts, profile: _profile);
            })();
      if (!mounted) return;
      setState(() => _routeResult = res);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _computeIsochrone() async {
    final lat = double.tryParse(_isoLatController.text.trim());
    final lon = double.tryParse(_isoLonController.text.trim());
    if (lat == null ||
        lon == null ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180) {
      setState(() => _error = 'Enter valid origin latitude and longitude.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final mins = (_isoContours.toList()..sort());
      final origin = LonLatPoint(lon: lon, lat: lat);
      final res = widget.isochroneOverride != null
          ? await widget.isochroneOverride!(
              origin: origin,
              profile: _profile,
              contoursMinutes: mins,
            )
          : await (() async {
              await RustBridge.ensureInitialized();
              return geoValhallaIsochrone(
                origin: origin,
                profile: _profile,
                contoursMinutes: mins,
              );
            })();
      if (!mounted) return;
      setState(() => _isoResult = res);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: widget.onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 2),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.alt_route,
                  size: 18,
                  color: EarthlyColors.infoCyan,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'ROUTING & ISOCHRONES (VALHALLA)',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontFamily: 'monospace',
                      letterSpacing: 0.6,
                    ),
                  ),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
            TabBar(
              controller: _tabs,
              dividerHeight: 0,
              tabs: const [
                Tab(key: Key('routing-tab-route'), text: 'Route (A → B)'),
                Tab(key: Key('routing-tab-iso'), text: 'Isochrone'),
              ],
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final p in const [
                  ('pedestrian', 'Walk', Icons.directions_walk),
                  ('bicycle', 'Bike', Icons.directions_bike),
                  ('auto', 'Drive', Icons.directions_car),
                ])
                  ChoiceChip(
                    key: Key('routing-profile-${p.$1}'),
                    avatar: Icon(p.$3, size: 15),
                    label: Text(p.$2),
                    selected: _profile == p.$1,
                    onSelected: (_) => setState(() => _profile = p.$1),
                  ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
              child: Text(
                _error!,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: EarthlyColors.destructive,
                ),
              ),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _buildRouteTab(theme),
                _buildIsochroneTab(theme),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteTab(ThemeData theme) {
    final res = _routeResult;
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 6, 14, 24),
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            OutlinedButton.icon(
              key: const Key('routing-add-center-btn'),
              onPressed: () => _addWaypointCoord(widget.mapCenter),
              icon: const Icon(Icons.my_location, size: 14),
              label: const Text('+ Map Center'),
            ),
            if (widget.draftWaypoints.isNotEmpty)
              OutlinedButton.icon(
                key: const Key('routing-add-draft-btn'),
                onPressed: () {
                  for (final wp in widget.draftWaypoints) {
                    _waypoints.add(wp);
                  }
                  setState(() {});
                },
                icon: const Icon(Icons.place_outlined, size: 14),
                label: Text('+ Draft Points (${widget.draftWaypoints.length})'),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('routing-wp-field'),
                controller: _wpInputController,
                onSubmitted: (_) => _addManualWaypoint(),
                decoration: const InputDecoration(
                  hintText: 'Add waypoint: 48.2082, 16.3738',
                ),
              ),
            ),
            const SizedBox(width: 6),
            OutlinedButton(
              key: const Key('routing-wp-add-btn'),
              onPressed: _addManualWaypoint,
              child: const Text('Add'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_waypoints.isEmpty)
          Text(
            'Add at least 2 waypoints (from Map Center, Draft Points, or coordinates).',
            style: theme.textTheme.bodySmall,
          )
        else
          for (var i = 0; i < _waypoints.length; i++)
            Container(
              margin: const EdgeInsets.only(bottom: 4),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                border: Border.all(color: theme.dividerColor),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '#${i + 1} · ${_waypoints[i].lat.toStringAsFixed(5)}, ${_waypoints[i].lon.toStringAsFixed(5)}',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11,
                      ),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: () => setState(() => _waypoints.removeAt(i)),
                    icon: const Icon(Icons.close, size: 15),
                  ),
                ],
              ),
            ),
        const SizedBox(height: 10),
        FilledButton.icon(
          key: const Key('routing-compute-route-btn'),
          onPressed: _busy ? null : _computeRoute,
          icon: const Icon(Icons.directions, size: 16),
          label: Text(_busy ? 'Routing…' : 'Compute Route'),
        ),
        if (res != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: EarthlyColors.commentGreen),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  res.summary,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  key: const Key('routing-import-route-btn'),
                  onPressed: () {
                    widget.onImportGeoJsonToDraft(res.geojson, res.summary);
                    widget.onClose();
                  },
                  icon: const Icon(Icons.add_box_outlined, size: 16),
                  label: const Text('Add Route to Draft'),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildIsochroneTab(ThemeData theme) {
    final res = _isoResult;
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 6, 14, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _isoLatController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Origin Lat'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _isoLonController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Origin Lon'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          'TRAVEL TIME BANDS (MINUTES)',
          style: theme.textTheme.labelSmall?.copyWith(
            fontFamily: 'monospace',
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final m in const [5, 10, 15, 20, 30])
              FilterChip(
                key: Key('routing-iso-min-$m'),
                label: Text('$m min'),
                selected: _isoContours.contains(m),
                onSelected: (sel) {
                  setState(() {
                    if (sel) {
                      _isoContours.add(m);
                    } else if (_isoContours.length > 1) {
                      _isoContours.remove(m);
                    }
                  });
                },
              ),
          ],
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          key: const Key('routing-compute-iso-btn'),
          onPressed: _busy ? null : _computeIsochrone,
          icon: const Icon(Icons.radar, size: 16),
          label: Text(_busy ? 'Computing…' : 'Compute Isochrone'),
        ),
        if (res != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: EarthlyColors.infoCyan.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: EarthlyColors.infoCyan),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  res.summary,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  key: const Key('routing-import-iso-btn'),
                  onPressed: () {
                    widget.onImportGeoJsonToDraft(res.geojson, res.summary);
                    widget.onClose();
                  },
                  icon: const Icon(Icons.add_box_outlined, size: 16),
                  label: const Text('Add Isochrones to Draft'),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
