# GeoJSON Editor for MapLibre GL

A powerful, extensible GeoJSON editing library for MapLibre GL with an intuitive API and responsive toolbar for both desktop and mobile.

## Features

✨ **Core Drawing Features**
- Draw Points, LineStrings, and Polygons
- Real-time visual feedback during drawing
- Intuitive click-to-draw interface

🎯 **Advanced Editing**
- Select and edit features
- Move features by dragging
- Delete selected features
- Multi-select with Shift key

🔧 **Smart Snapping**
- Snap to vertices
- Snap to edges
- Configurable snap distance
- Toggle snapping on/off

⏱️ **Undo/Redo**
- Full history management
- Keyboard shortcuts (Cmd/Ctrl + Z)
- Tracks create, update, and delete operations

🎨 **Transform Operations**
- Rotate features around a center point
- Scale features
- Translate/move features
- Split lines at points
- Union and difference operations
- Buffer operations
- Simplify geometries

👥 **Grouping & Selection**
- Create feature groups
- Select groups
- Box selection support
- Multi-feature operations

📱 **Responsive Toolbar**
- Desktop-optimized layout
- Mobile-friendly menu
- Touch-enabled controls
- Customizable positioning

## Installation

```bash
bun add maplibre-gl @turf/turf
```

## Quick Start

```typescript
import { Map } from 'maplibre-gl';
import { GeoEditor } from './geo-editor';
import 'maplibre-gl/dist/maplibre-gl.css';

// Initialize map
const map = new Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [-74.006, 40.7128],
  zoom: 12
});

// Initialize editor
const editor = new GeoEditor(map, {
  defaultMode: 'select',
  snapping: true,
  snapDistance: 10
});

// Listen to events
editor.on('create', (event) => {
  console.log('Feature created:', event.features);
});

editor.on('update', (event) => {
  console.log('Feature updated:', event.features);
});

editor.on('delete', (event) => {
  console.log('Feature deleted:', event.features);
});
```

## API Reference

### GeoEditor

#### Constructor

```typescript
new GeoEditor(map: Map, options?: GeoEditorOptions)
```

**Options:**
- `modes` - Available editing modes (default: all modes)
- `defaultMode` - Initial mode (default: 'static')
- `features` - Drawable feature types (default: ['Point', 'LineString', 'Polygon'])
- `snapping` - Enable snapping (default: true)
- `snapDistance` - Snap distance in pixels (default: 10)
- `snapToVertices` - Snap to vertices (default: true)
- `snapToEdges` - Snap to edges (default: true)
- `styles` - Custom styling options
- `touchEnabled` - Enable touch controls (default: true)
- `boxSelect` - Enable box selection (default: true)
- `clickTolerance` - Click tolerance in pixels (default: 2)

#### Methods

**Mode Management:**
```typescript
editor.setMode(mode: EditorMode): void
editor.getMode(): EditorMode
```

**Feature Management:**
```typescript
editor.addFeature(feature: EditorFeature): void
editor.updateFeature(featureId: string, feature: EditorFeature): void
editor.deleteFeature(featureId: string): void
editor.deleteFeatures(featureIds: string[]): void
editor.getFeature(featureId: string): EditorFeature | undefined
editor.getAllFeatures(): EditorFeature[]
editor.getSelectedFeatures(): EditorFeature[]
editor.setFeatures(features: EditorFeature[]): void
```

**History:**
```typescript
editor.undo(): void
editor.redo(): void
```

**Events:**
```typescript
editor.on(eventType: EditorEventType, handler: EditorEventHandler): void
editor.off(eventType: EditorEventType, handler: EditorEventHandler): void
```

**Cleanup:**
```typescript
editor.destroy(): void
```

#### Events

- `mode.change` - Fired when mode changes
- `create` - Fired when feature is created
- `update` - Fired when feature is updated
- `delete` - Fired when feature is deleted
- `selection.change` - Fired when selection changes
- `undo` - Fired when undo is performed
- `redo` - Fired when redo is performed
- `snap` - Fired when snapping occurs

### Managers

#### HistoryManager

```typescript
editor.history.canUndo(): boolean
editor.history.canRedo(): boolean
editor.history.clear(): void
editor.history.getHistory(): HistoryAction[]
```

#### SnapManager

```typescript
editor.snap.setEnabled(enabled: boolean): void
editor.snap.isEnabled(): boolean
editor.snap.setSnapDistance(distance: number): void
editor.snap.snap(point: Position, features: EditorFeature[]): SnapResult
```

#### SelectionManager

```typescript
editor.selection.select(featureId: string | string[]): void
editor.selection.deselect(featureId: string | string[]): void
editor.selection.toggleSelect(featureId: string): void
editor.selection.clearSelection(): void
editor.selection.isSelected(featureId: string): boolean
editor.selection.getSelected(): string[]
editor.selection.selectInBounds(features: EditorFeature[], bounds: SelectionBounds): string[]

// Groups
editor.selection.createGroup(groupId: string, featureIds: string[]): void
editor.selection.addToGroup(groupId: string, featureId: string | string[]): void
editor.selection.removeFromGroup(groupId: string, featureId: string | string[]): void
editor.selection.deleteGroup(groupId: string): void
editor.selection.getGroup(groupId: string): string[]
editor.selection.selectGroup(groupId: string): void
```

#### TransformManager

```typescript
editor.transform.rotate(feature: EditorFeature, options: TransformOptions): EditorFeature
editor.transform.rotateMultiple(features: EditorFeature[], options: TransformOptions): EditorFeature[]
editor.transform.scale(feature: EditorFeature, options: TransformOptions): EditorFeature
editor.transform.move(feature: EditorFeature, from: Position, to: Position): EditorFeature
editor.transform.splitLine(feature: EditorFeature, splitPoint: Position): [EditorFeature, EditorFeature] | null
editor.transform.union(features: EditorFeature[]): EditorFeature | null
editor.transform.difference(feature1: EditorFeature, feature2: EditorFeature): EditorFeature | null
editor.transform.buffer(feature: EditorFeature, radius: number): EditorFeature
editor.transform.simplify(feature: EditorFeature, tolerance?: number): EditorFeature
```

## Toolbar Component

```tsx
import { Toolbar } from './geo-editor/components/Toolbar';

<Toolbar
  editor={editor}
  position="top-left" // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
/>
```

The toolbar provides:
- Mode switching buttons (Select, Draw Point, Draw Line, Draw Polygon)
- Action buttons (Undo, Redo, Delete)
- Selection counter
- Responsive design (mobile menu on small screens)

## Modes

### `static`
No editing, just viewing

### `select`
Select and manipulate features
- Click to select
- Shift+Click for multi-select
- Delete key to remove selected

### `draw_point`
Draw point features
- Click to place point

### `draw_linestring`
Draw line features
- Click to add vertices
- Double-click or Enter to finish
- Backspace to remove last vertex
- Escape to cancel

### `draw_polygon`
Draw polygon features
- Click to add vertices
- Click on first vertex or Enter to close
- Backspace to remove last vertex
- Escape to cancel

### `edit`
Edit existing features (vertex manipulation)

## Keyboard Shortcuts

- **Cmd/Ctrl + Z** - Undo
- **Cmd/Ctrl + Shift + Z** - Redo
- **Delete/Backspace** - Delete selected features
- **Enter** - Finish drawing (line/polygon)
- **Escape** - Cancel current operation
- **Backspace** (while drawing) - Remove last vertex

## Styling

The editor comes with default styles but can be customized via the `styles` option:

```typescript
const editor = new GeoEditor(map, {
  styles: {
    vertex: { /* custom MapLibre style */ },
    line: { /* custom MapLibre style */ },
    polygon: { /* custom MapLibre style */ },
    // ... more style options
  }
});
```

## Advanced Usage

### Import/Export GeoJSON

```typescript
// Export
const geojson = {
  type: 'FeatureCollection',
  features: editor.getAllFeatures()
};

// Import
const features = geojson.features.map((f, index) => ({
  ...f,
  id: f.id || `imported_${index}`,
  properties: {
    ...f.properties,
    meta: 'feature'
  }
}));
editor.setFeatures(features);
```

### Custom Transform Operations

```typescript
// Rotate a feature
const rotated = editor.transform.rotate(feature, {
  center: [lng, lat],
  angle: 45 // degrees
});
editor.updateFeature(feature.id, rotated);

// Buffer a feature
const buffered = editor.transform.buffer(feature, 100, 'meters');
editor.addFeature(buffered);

// Split a line
const result = editor.transform.splitLine(lineFeature, [lng, lat]);
if (result) {
  const [part1, part2] = result;
  editor.deleteFeature(lineFeature.id);
  editor.addFeature(part1);
  editor.addFeature(part2);
}
```

### Working with Groups

```typescript
// Create a group
editor.selection.createGroup('buildings', ['feature1', 'feature2']);

// Select entire group
editor.selection.selectGroup('buildings');

// Delete entire group
const groupFeatures = editor.selection.getGroup('buildings');
editor.deleteFeatures(groupFeatures);
```

## Browser Support

- Modern browsers with ES6+ support
- Mobile browsers (iOS Safari, Chrome Android)
- Touch and mouse input

## Dependencies

- `maplibre-gl` - Map rendering
- `@turf/turf` - Geospatial operations
- `react` - UI components (for Toolbar)
- `lucide-react` - Icons

## License

MIT

## Contributing

Contributions welcome! The architecture is designed to be extensible:

1. **New Drawing Modes** - Extend `DrawMode` class
2. **Custom Managers** - Implement `IManager` interface
3. **Custom Styles** - Provide via options
4. **New Transform Operations** - Add to `TransformManager`

## Examples

See [src/components/GeoEditorDemo.tsx](src/components/GeoEditorDemo.tsx) for a complete working example with:
- Map initialization
- Editor setup
- Event handling
- Import/export functionality
- Statistics display