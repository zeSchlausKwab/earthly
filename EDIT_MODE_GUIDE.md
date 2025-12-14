# Edit Mode Guide

The Edit Mode allows you to modify existing features by manipulating their vertices directly.

## Visual Indicators

When a feature is selected in Edit mode:
- **Dashed orange stroke** - Indicates the feature is in edit mode
- **Orange circles** - Existing vertices that can be dragged
- **White circles with orange border** - Midpoints where you can add new vertices

## How to Use Edit Mode

### 1. Activate Edit Mode
Click the **Edit Vertices** button (pencil icon) in the toolbar.

### 2. Select a Feature
Click on any feature (point, line, or polygon) to select it for editing.

### 3. Edit Operations

#### **Move Vertices**
- Click and drag any orange vertex circle to move it
- The vertex snaps to nearby features if snapping is enabled
- Release to commit the change

#### **Add Vertices**
- Click on any white midpoint circle to insert a new vertex at that location
- New vertex is automatically added between the two adjacent vertices

#### **Delete Vertices**
- Right-click on any vertex to delete it
- Minimum vertex requirements:
  - LineStrings: Must have at least 2 vertices
  - Polygons: Must have at least 3 vertices

### 4. Keyboard Shortcuts in Edit Mode
- **Delete/Backspace** - Delete the selected feature(s)
- **Cmd/Ctrl + Z** - Undo last change
- **Cmd/Ctrl + Shift + Z** - Redo
- **Escape** - Deselect current feature

## Features

### Snapping
Vertices automatically snap to:
- Other vertices within the snap distance
- Edges of other features
- Can be toggled on/off via editor options

### Multi-Feature Editing
- Select multiple features by Shift+Click
- All selected features show their vertices
- Edit any vertex on any selected feature

### Undo/Redo Support
All vertex modifications are tracked in history:
- Moving vertices
- Adding vertices
- Deleting vertices

## Example Usage

```typescript
// Switch to edit mode
editor.setMode('edit');

// Listen for updates
editor.on('update', (event) => {
  console.log('Feature updated:', event.features);
});

// Programmatically edit vertices
const feature = editor.getFeature('feature-id');
if (feature) {
  const updated = editor.editMode.updateVertexPosition(
    feature,
    [0], // coordinate path for first vertex
    [-74.006, 40.7128] // new position
  );
  editor.updateFeature(feature.id, updated);
}
```

## Visual Styling

The edit mode uses distinctive visual styling:
- **Active features**: Orange color (#fbb03b)
- **Dashed stroke**: [2, 2] dash pattern
- **Vertices**: 5px radius circles
- **Midpoints**: 4px radius circles
- **Cursor changes**:
  - `move` on vertex hover
  - `pointer` on midpoint hover
  - `grabbing` while dragging

## Supported Geometries

- ✅ **Point** - Move the point
- ✅ **LineString** - Add, move, delete vertices
- ✅ **Polygon** - Add, move, delete vertices on all rings
- 🚧 **MultiPoint** - Partial support
- 🚧 **MultiLineString** - Partial support
- 🚧 **MultiPolygon** - Partial support

## Tips

1. **Use snapping** for precise vertex placement
2. **Zoom in** for fine-grained vertex editing
3. **Right-click** to quickly delete unwanted vertices
4. **Shift+Click** to edit multiple features simultaneously
5. **Use undo** liberally - all changes are reversible

## Mobile Support

On mobile devices:
- Tap to select features
- Long-press and drag to move vertices
- Single tap midpoints to add vertices
- Use the mobile menu to access delete function