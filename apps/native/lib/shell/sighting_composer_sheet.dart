import 'dart:typed_data';

import 'package:maplibre/maplibre.dart';
import 'package:material_ui/material_ui.dart';

import '../nostr/nip55_signer.dart';
import '../runtime/camera_capture.dart';
import '../runtime/device_bridge.dart';
import '../src/rust/api/nostr_client.dart';
import '../src/rust/api/publish.dart';
import '../theme/earthly_theme.dart';
import 'desk_sheet.dart';
import 'map_drawer.dart';

class SightingPublishRequest {
  const SightingPublishRequest({
    required this.title,
    required this.note,
    required this.lon,
    required this.lat,
    required this.durationHours,
    required this.audience,
    this.photoBytes,
    this.photoMimeType,
  });

  final String title;
  final String note;
  final double lon;
  final double lat;
  final int durationHours;
  final DraftAudienceChoice audience;
  final Uint8List? photoBytes;
  final String? photoMimeType;
}

class SightingPublishResult {
  const SightingPublishResult({
    required this.outcome,
    required this.sighting,
  });

  final PublishOutcomeDto outcome;
  final SightingSummaryDto sighting;
}

/// Field Capture composer for Temporal Sightings (`kind 37522`):
/// GPS or map center + optional camera/gallery photo (stored in embedded Blossom)
/// + NIP-40 expiry window → Amber NIP-55 signing → SQLite Outbox publish.
class SightingComposerSheet extends StatefulWidget {
  const SightingComposerSheet({
    required this.initialLocation,
    required this.account,
    required this.onPublishSighting,
    super.key,
  });

  final Geographic initialLocation;
  final Nip55Account? account;
  final Future<SightingPublishResult> Function(SightingPublishRequest req)
      onPublishSighting;

  @override
  State<SightingComposerSheet> createState() => _SightingComposerSheetState();
}

class _SightingComposerSheetState extends State<SightingComposerSheet> {
  final _titleController = TextEditingController();
  final _noteController = TextEditingController();

  late double _lat = widget.initialLocation.lat;
  late double _lon = widget.initialLocation.lon;
  String _locationSource = 'Map center';
  int _durationHours = 24;
  DraftAudienceChoice _audience = DraftAudienceChoice.publicRelay;

  PickedBinaryFile? _photo;
  bool _locating = false;
  bool _publishing = false;
  String? _error;
  PublishOutcomeDto? _outcome;

  @override
  void dispose() {
    _titleController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _useGps() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      final fix = await DeviceBridge.getCurrentLocation();
      if (!mounted) return;
      setState(() {
        _lat = fix.lat;
        _lon = fix.lon;
        _locationSource =
            'GPS (±${fix.accuracyMeters.round()} m)';
      });
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = 'GPS unavailable: $err');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _pickPhoto({required bool camera}) async {
    setState(() => _error = null);
    try {
      final picked = camera
          ? await CameraCapture.capturePhoto(context)
          : await DeviceBridge.pickImage();
      if (!mounted || picked == null) return;
      setState(() => _photo = picked);
    } catch (err) {
      if (CameraCapture.isCancellation(err)) return;
      if (!mounted) return;
      setState(() => _error = 'Photo not attached: $err');
    }
  }

  Future<void> _publish() async {
    setState(() {
      _publishing = true;
      _error = null;
    });
    try {
      final result = await widget.onPublishSighting(
        SightingPublishRequest(
          title: _titleController.text.trim(),
          note: _noteController.text.trim(),
          lon: _lon,
          lat: _lat,
          durationHours: _durationHours,
          audience: _audience,
          photoBytes: _photo?.bytes,
          photoMimeType: _photo?.mimeType,
        ),
      );
      if (!mounted) return;
      setState(() => _outcome = result.outcome);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = err.toString());
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 12, 16, 16 + bottomInset),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.add_a_photo_outlined,
                    size: 18,
                    color: Color(0xFFD97706),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'New Sighting',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, size: 18),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Coordinate + GPS bar
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  border: Border.all(color: theme.dividerColor),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _locationSource,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 12,
                            ),
                          ),
                          Text(
                            '${_lat.toStringAsFixed(5)}, ${_lon.toStringAsFixed(5)}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: _locating ? null : _useGps,
                      icon: _locating
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.gps_fixed, size: 15),
                      label: const Text('Use GPS'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),

              TextField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title (e.g. Fallen tree, Peregrine falcon)',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _noteController,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Observation note',
                ),
              ),
              const SizedBox(height: 10),

              // Photo capture / gallery row
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _publishing
                          ? null
                          : () => _pickPhoto(camera: true),
                      icon: const Icon(Icons.photo_camera_outlined, size: 16),
                      label: const Text('Camera'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _publishing
                          ? null
                          : () => _pickPhoto(camera: false),
                      icon: const Icon(Icons.photo_library_outlined, size: 16),
                      label: const Text('Gallery'),
                    ),
                  ),
                ],
              ),
              if (_photo != null) ...[
                const SizedBox(height: 8),
                Stack(
                  children: [
                    Container(
                      height: 120,
                      width: double.infinity,
                      decoration: BoxDecoration(
                        border: Border.all(color: theme.dividerColor),
                      ),
                      child: Image.memory(_photo!.bytes, fit: BoxFit.cover),
                    ),
                    Positioned(
                      top: 4,
                      right: 4,
                      child: IconButton.filled(
                        visualDensity: VisualDensity.compact,
                        onPressed: () => setState(() => _photo = null),
                        icon: const Icon(Icons.close, size: 16),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 10),

              // Expiry window (NIP-40)
              const Text(
                'EXPIRES IN',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              EarthlySegmentBar<int>.single(
                key: const Key('sighting-expiry-bar'),
                monospace: true,
                options: [
                  for (final hours in const [6, 24, 72, 168])
                    EarthlySegmentOption<int>(
                      value: hours,
                      label: hours >= 24 ? '${hours ~/ 24}d' : '${hours}h',
                    ),
                ],
                value: _durationHours,
                onChanged: (hours) => setState(() => _durationHours = hours),
              ),
              const SizedBox(height: 10),

              // Audience channel
              EarthlySegmentBar<DraftAudienceChoice>.single(
                key: const Key('sighting-audience-bar'),
                options: const [
                  EarthlySegmentOption<DraftAudienceChoice>(
                    value: DraftAudienceChoice.publicRelay,
                    label: 'Public Relay',
                    icon: Icons.public,
                  ),
                  EarthlySegmentOption<DraftAudienceChoice>(
                    value: DraftAudienceChoice.nearbyLocalNode,
                    label: 'Nearby Local Node',
                    icon: Icons.wifi_tethering,
                  ),
                ],
                value: _audience,
                onChanged: (aud) => setState(() => _audience = aud),
              ),

              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: EarthlyColors.destructive,
                  ),
                ),
              ],

              if (_outcome != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  color: EarthlyColors.commentGreen.withValues(alpha: 0.12),
                  child: Text(
                    'Published Sighting (${_outcome!.outboxState}) · id ${_outcome!.eventId.substring(0, 10)}...',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],

              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _publishing ? null : _publish,
                icon: _publishing
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.key, size: 16),
                label: Text(
                  _publishing
                      ? 'Signing with Amber...'
                      : 'Sign with Amber & Drop Sighting',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
