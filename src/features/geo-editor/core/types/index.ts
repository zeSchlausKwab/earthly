import type { Map, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  Position,
} from 'geojson';

export type EditorMode =
  | 'draw_point'
  | 'draw_linestring'
  | 'draw_polygon'
  | 'edit'
  | 'select'
  | 'static';

export type DrawFeatureType = 'Point' | 'LineString' | 'Polygon';

export interface GeoEditorOptions {
  modes?: EditorMode[];
  defaultMode?: EditorMode;
  features?: DrawFeatureType[];
  snapping?: boolean;
  snapDistance?: number;
  snapToVertices?: boolean;
  snapToEdges?: boolean;
  styles?: EditorStyles;
  displayControlsDefault?: boolean;
  touchEnabled?: boolean;
  boxSelect?: boolean;
  clickTolerance?: number;
  pointerOffsetPx?: {
    x: number;
    y: number;
  };
}

export interface EditorStyles {
  vertex?: any;
  vertexActive?: any;
  vertexInactive?: any;
  line?: any;
  lineActive?: any;
  lineInactive?: any;
  polygon?: any;
  polygonActive?: any;
  polygonInactive?: any;
  point?: any;
  pointActive?: any;
  pointInactive?: any;
  midpoint?: any;
}

export interface EditorFeature extends Feature {
  id: string;
  properties: GeoJsonProperties & {
    meta?: string;
    active?: boolean;
    mode?: string;
    parent?: string;
    coord_path?: string;
    featureId?: string;
    name?: string;
    description?: string;
    color?: string;
    customProperties?: Record<string, any>;
  };
}

export interface HistoryAction {
  type: 'create' | 'update' | 'delete';
  features: EditorFeature[];
  previousFeatures?: EditorFeature[];
  timestamp: number;
}

export interface SnapResult {
  snapped: boolean;
  point: Position;
  feature?: EditorFeature;
  vertexIndex?: number;
  edgeIndex?: number;
}

export interface TransformOptions {
  center: Position;
  angle?: number;
  scale?: number;
}

export interface SelectionBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type EditorEventType =
  | 'mode.change'
  | 'create'
  | 'update'
  | 'delete'
  | 'selection.change'
  | 'undo'
  | 'redo'
  | 'snap'
  | 'draw.change';

export interface EditorEvent {
  type: EditorEventType;
  features?: EditorFeature[];
  mode?: EditorMode;
}

export type EditorEventHandler = (event: EditorEvent) => void;

export interface IManager {
  onAdd(map: Map): void;
  onRemove(): void;
}
