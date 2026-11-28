import 'package:material_ui/material_ui.dart';

import '../theme/earthly_theme.dart';
import 'guided_tour_dialog.dart';
import 'map_drawer.dart';

/// Quick field guide covering desktop keyboard shortcuts, touch drawing
/// gestures, and Earthly's visual color grammar.
class HelpShortcutsSheet extends StatelessWidget {
  const HelpShortcutsSheet({required this.onClose, super.key});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return EarthlyMapDrawer(
      initialFraction: 0.56,
      onClose: onClose,
      header: Padding(
        padding: const EdgeInsets.fromLTRB(14, 0, 8, 6),
        child: Row(
          children: [
            const Icon(
              Icons.help_outline,
              size: 18,
              color: EarthlyColors.infoCyan,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Help & Shortcuts',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: onClose,
              icon: const Icon(Icons.close, size: 18),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
        children: [
          FilledButton.icon(
            key: const Key('help-start-tour-btn'),
            onPressed: () => showEarthlyGuidedTourDialog(context),
            icon: const Icon(Icons.explore_outlined, size: 17),
            label: const Text('Start 5-Step Guided Tour'),
          ),
          const SizedBox(height: 14),
          _sectionTitle(theme, 'KEYBOARD SHORTCUTS (DESKTOP)'),
          const SizedBox(height: 6),
          for (final entry in const [
            ('Cmd / Ctrl + Z', 'Undo last vertex (while drawing) or draft edit'),
            ('Cmd / Ctrl + Shift + Z', 'Redo draft geometry edit'),
            ('Cmd / Ctrl + D', 'Duplicate selected draft feature(s)'),
            ('Esc', 'Cancel active drawing vertex or close active drawer'),
            ('Long-press Map', 'Open Location Inspector + Nearby Maps/OSM/Isochrone'),
          ])
            _shortcutRow(theme, entry.$1, entry.$2),
          const SizedBox(height: 16),
          _sectionTitle(theme, 'TOUCH DRAWING & FIELD GESTURES'),
          const SizedBox(height: 6),
          for (final entry in const [
            ('1-Finger Draw-Drag', 'Sketch geometry smoothly offset -48dp with GPU loupe'),
            ('2-Finger Pan / Pinch', 'Navigate & rotate map freely even while drawing'),
            ('2-Finger Tap', 'Instant undo last placed point'),
            ('Swipe Drawer Down', 'Implicitly dismiss the active bottom drawer'),
          ])
            _shortcutRow(theme, entry.$1, entry.$2),
          const SizedBox(height: 16),
          _sectionTitle(theme, 'EARTHLY VISUAL GRAMMAR'),
          const SizedBox(height: 6),
          for (final swatch in const [
            ('Published Shelf Layers', EarthlyColors.published),
            ('Working Local Draft', EarthlyColors.lightAccent),
            ('AI Agent Ghost / Proposal Preview', EarthlyColors.proposedAmber),
            ('Comment GeoJSON Annotation', EarthlyColors.commentGreen),
            ('Live Beacon & Location Inspector', EarthlyColors.infoCyan),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Container(
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                      color: swatch.$2,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(swatch.$1, style: theme.textTheme.bodySmall),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _sectionTitle(ThemeData theme, String title) => Text(
        title,
        style: theme.textTheme.labelSmall?.copyWith(
          fontFamily: 'monospace',
          fontWeight: FontWeight.w800,
        ),
      );

  Widget _shortcutRow(ThemeData theme, String keyCap, String desc) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 164),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: theme.dividerColor),
                ),
                child: Text(
                  keyCap,
                  maxLines: 1,
                  softWrap: false,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(desc, style: theme.textTheme.bodySmall),
            ),
          ],
        ),
      );
}
