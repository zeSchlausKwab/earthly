import 'dart:io';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../src/rust/api/spike.dart';
import '../src/rust/frb_generated.dart';
import '../theme/earthly_theme.dart';

/// Phase 0 diagnostic sheet proving Flutter ↔ Rust FFI across:
/// - `earthly-local-node` (embedded LMDB relay + Blossom HTTP server)
/// - `earthly-spatial` (PMTiles v3 binary header validation)
/// - `earthly-storage` (durable SQLite publish outbox)
class RustNodeSheet extends StatefulWidget {
  const RustNodeSheet({super.key});

  @override
  State<RustNodeSheet> createState() => _RustNodeSheetState();
}

class _RustNodeSheetState extends State<RustNodeSheet> {
  static bool _ffiInitialized = false;

  bool _busy = false;
  String? _error;
  LocalNodeSnapshot? _node;
  IngestedPmtilesSnapshot? _ingested;
  OutboxSummarySnapshot? _outbox;
  String? _rangeProof;

  @override
  void initState() {
    super.initState();
    if (_ffiInitialized) {
      localNodeStatus().then((status) {
        if (mounted && status.running) {
          setState(() => _node = status);
        }
      });
    }
  }

  Future<void> _ensureFfi() async {
    if (_ffiInitialized || EarthlyRustLib.instance.initialized) {
      _ffiInitialized = true;
      return;
    }
    await EarthlyRustLib.init();
    _ffiInitialized = true;
  }

  Future<String> _verifyLoopbackRangeRead(IngestedPmtilesSnapshot ingested) async {
    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse(ingested.blobUrl));
      request.headers.set('Authorization', ingested.authorization);
      request.headers.set('Range', 'bytes=0-6');
      final response = await request.close();
      final bytes = await response.fold<List<int>>(
        <int>[],
        (buffer, chunk) => buffer..addAll(chunk),
      );
      final magic = String.fromCharCodes(bytes);
      return 'HTTP ${response.statusCode} · "$magic" (${bytes.length} B)';
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _bootAndVerify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _ensureFfi();
      final appDir = await getApplicationSupportDirectory();
      final node = await startLocalNode(dataDir: '${appDir.path}/local-node');
      final outbox = await outboxSummary(
        databasePath: '${appDir.path}/earthly.sqlite3',
      );
      final ingested = await ingestLocalPmtiles(
        bytes: _buildSyntheticPmtilesV3(),
        label: 'vienna-spike.pmtiles',
      );
      final rangeProof = await _verifyLoopbackRangeRead(ingested);
      if (!mounted) return;
      setState(() {
        _node = node;
        _outbox = outbox;
        _ingested = ingested;
        _rangeProof = rangeProof;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  static Uint8List _buildSyntheticPmtilesV3() {
    final bytes = Uint8List(127 + 32);
    final data = ByteData.sublistView(bytes);
    const magic = [0x50, 0x4D, 0x54, 0x69, 0x6C, 0x65, 0x73]; // "PMTiles"
    for (var i = 0; i < magic.length; i++) {
      bytes[i] = magic[i];
    }
    bytes[7] = 3; // version 3
    bytes[96] = 1; // clustered
    bytes[97] = 2; // gzip internal
    bytes[98] = 2; // gzip tile
    bytes[99] = 1; // MVT
    bytes[100] = 0; // min zoom
    bytes[101] = 14; // max zoom
    data.setInt32(102, 161800000, Endian.little); // west 16.18
    data.setInt32(106, 481100000, Endian.little); // south 48.11
    data.setInt32(110, 165800000, Endian.little); // east 16.58
    data.setInt32(114, 483200000, Endian.little); // north 48.32
    bytes[118] = 12; // center zoom
    data.setInt32(119, 163738000, Endian.little); // center lon
    data.setInt32(123, 482082000, Endian.little); // center lat
    return bytes;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text(
                  'RUST CORE · PHASE 0 PROOF',
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontFamily: 'monospace',
                    letterSpacing: 0.8,
                  ),
                ),
                const Spacer(),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close, size: 18),
                ),
              ],
            ),
            const Divider(height: 16),
            Text(
              'Starts earthly-local-node (LMDB relay + Blossom), opens earthly-storage (SQLite outbox), and validates + ingests a PMTiles v3 archive via earthly-spatial.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _busy ? null : _bootAndVerify,
              icon: _busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.play_arrow, size: 18),
              label: Text(_busy ? 'Running Rust FFI check…' : 'Boot Node & Run PMTiles Proof'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(10),
                color: EarthlyColors.destructive.withValues(alpha: 0.12),
                child: Text(
                  _error!,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: EarthlyColors.destructive,
                  ),
                ),
              ),
            ],
            if (_node != null) ...[
              const SizedBox(height: 12),
              _InfoRow('Node scope', _node!.scope ?? '—'),
              _InfoRow('Relay URL', _node!.relayUrl ?? '—'),
              _InfoRow('Blossom URL', _node!.blossomUrl ?? '—'),
            ],
            if (_ingested != null) ...[
              const Divider(height: 16),
              _InfoRow('PMTiles format', '${_ingested!.header.format} (z${_ingested!.header.minZoom}–${_ingested!.header.maxZoom})'),
              _InfoRow('Local blob URL', _ingested!.blobUrl),
              _InfoRow('SHA-256', '${_ingested!.sha256.substring(0, 16)}…'),
              if (_rangeProof != null) _InfoRow('Range read', _rangeProof!),
            ],
            if (_outbox != null) ...[
              const Divider(height: 16),
              _InfoRow('SQLite Outbox', 'total ${_outbox!.total} · queued ${_outbox!.queued} · delivered ${_outbox!.delivered}'),
            ],
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
