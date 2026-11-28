import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';

class _TourStepData {
  const _TourStepData({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.bullets,
    this.callout,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<String> bullets;
  final String? callout;
}

const List<_TourStepData> _tourSteps = <_TourStepData>[
  _TourStepData(
    icon: Icons.public,
    title: 'Welcome to Earthly',
    subtitle: 'Decentralized collaborative cartography powered by Nostr & Rust.',
    bullets: [
      'Explore community Maps (kind 37515), Stories (37520), Atlases (37518), and Sightings (37522).',
      'Draw points, lines, and polygons locally in SQLite without forced sign-in.',
      'Comment, propose geometry or Markdown edits, react, and send Lightning zaps.',
    ],
    callout:
        'Maps carry geometry. Atlases organize & validate it. Comments discuss it. Proposals change it.',
  ),
  _TourStepData(
    icon: Icons.key_outlined,
    title: 'Nostr Identity & NWC Wallet',
    subtitle: 'Your keys stay on your device or remote signer — never on a central server.',
    bullets: [
      'Manage multiple simultaneous accounts in Account Settings (Local Key, NIP-46 Bunker, Android Amber NIP-55, or Read-Only watch sessions).',
      'Use the 2-step Backup Local Key wizard to reveal, scan, and verify your nsec1 secret key.',
      'Connect a Nostr Wallet Connect (NIP-47) URI for 1-tap Lightning zaps.',
    ],
  ),
  _TourStepData(
    icon: Icons.draw_outlined,
    title: 'Precision Touch Drawing & Workbench',
    subtitle: 'Built natively on MapLibre GPU with Rust geospatial ops.',
    bullets: [
      '1-finger draw-drag (-48dp thumb offset + live GPU loupe) & 2-finger pan/zoom/tap-undo.',
      'Multi-select features on Desk to run 18 Rust tools: Corridor, Flow Arrow, Union, Split, Connect Lines, and Dissolve Lines.',
      'Import & export GeoJSON, GPX, KML, CSV tables, and multi-layer ESRI Shapefiles (.zip).',
    ],
  ),
  _TourStepData(
    icon: Icons.auto_stories_outlined,
    title: 'Stories, Atlases & Collaboration',
    subtitle: 'Turn spatial datasets into living geographic narratives.',
    bullets: [
      'Write Markdown Stories with Follow Text scrollytelling views and inline vector figures.',
      'Link Maps & Authors directly with the searchable \$ Map and @ Person mention pickers.',
      'Join the 4-tab Community Shoutbox from Spaces to share feedback or browse updates.',
    ],
  ),
  _TourStepData(
    icon: Icons.auto_awesome,
    title: 'Offline Packs, Nearby & AI Copilot',
    subtitle: 'Field-ready even without cellular signal.',
    bullets: [
      'Mount offline .pmtiles and .atlas bundles cleanly in Basemap Settings.',
      'Host or scan Nearby Field Sessions over LAN Wi-Fi or FIPS IPv6 mesh.',
      'Use the Rust AI Copilot (offline or OpenAI/Ollama + /models) with Safe Editing amber ghost diffs.',
    ],
  ),
];

/// Opens Earthly's interactive 5-step Guided Quick-Start Tour dialog.
Future<void> showEarthlyGuidedTourDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (_) => const _EarthlyGuidedTourDialog(),
  );
}

class _EarthlyGuidedTourDialog extends StatefulWidget {
  const _EarthlyGuidedTourDialog();

  @override
  State<_EarthlyGuidedTourDialog> createState() =>
      _EarthlyGuidedTourDialogState();
}

class _EarthlyGuidedTourDialogState extends State<_EarthlyGuidedTourDialog> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final step = _tourSteps[_index];
    final isLast = _index == _tourSteps.length - 1;

    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      title: Row(
        children: [
          Icon(step.icon, size: 20, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              step.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: 360,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'STEP ${_index + 1} OF ${_tourSteps.length}',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                  color: theme.colorScheme.primary,
                ),
              ),
              const SizedBox(height: 4),
              LinearProgressIndicator(
                value: (_index + 1) / _tourSteps.length,
                minHeight: 4,
              ),
              const SizedBox(height: 12),
              Text(
                step.subtitle,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              for (final b in step.bullets)
                Padding(
                  padding: const EdgeInsets.only(bottom: 7),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('• '),
                      Expanded(
                        child: Text(b, style: theme.textTheme.bodySmall),
                      ),
                    ],
                  ),
                ),
              if (step.callout != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: EarthlyColors.infoCyan.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border(
                      left: BorderSide(color: EarthlyColors.infoCyan, width: 3),
                    ),
                  ),
                  child: Text(
                    step.callout!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Skip'),
        ),
        if (_index > 0)
          TextButton(
            onPressed: () => setState(() => _index -= 1),
            child: const Text('Back'),
          ),
        if (!isLast)
          FilledButton(
            key: const Key('tour-next-btn'),
            onPressed: () => setState(() => _index += 1),
            child: const Text('Next →'),
          )
        else
          FilledButton(
            key: const Key('tour-finish-btn'),
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Finish Tour'),
          ),
      ],
    );
  }
}
