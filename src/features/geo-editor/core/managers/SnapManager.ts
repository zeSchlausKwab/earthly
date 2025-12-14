import type { Position } from 'geojson';
import type { Map } from 'maplibre-gl';
import type { EditorFeature, SnapResult, IManager } from '../types';
import { closestVertex, nearestPointOnLine, pixelDistance, isValidPosition } from '../utils/geometry';

export class SnapManager implements IManager {
  private map?: Map;
  private snapDistance: number;
  private snapToVertices: boolean;
  private snapToEdges: boolean;
  private enabled: boolean;

  constructor(
    snapDistance: number = 10,
    snapToVertices: boolean = true,
    snapToEdges: boolean = true
  ) {
    this.snapDistance = snapDistance;
    this.snapToVertices = snapToVertices;
    this.snapToEdges = snapToEdges;
    this.enabled = true;
  }

  onAdd(map: Map): void {
    this.map = map;
  }

  onRemove(): void {
    this.map = undefined;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setSnapping(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setSnapDistance(distance: number): void {
    this.snapDistance = distance;
  }

  snap(point: Position, features: EditorFeature[], excludeFeatureIds: string[] = []): SnapResult {
    if (!this.enabled || !this.map) {
      return { snapped: false, point };
    }

    const relevantFeatures = features.filter(f => !excludeFeatureIds.includes(f.id));

    let closestSnap: SnapResult = { snapped: false, point };
    let minPixelDistance = this.snapDistance;

    // Check vertex snapping
    if (this.snapToVertices) {
      for (const feature of relevantFeatures) {
        const vertices = this.extractVertices(feature);
        const { index, distance } = closestVertex(point, vertices);

        if (index >= 0) {
          const pixelDist = pixelDistance(this.map, point, vertices[index]);
          if (pixelDist < minPixelDistance) {
            minPixelDistance = pixelDist;
            closestSnap = {
              snapped: true,
              point: vertices[index],
              feature,
              vertexIndex: index
            };
          }
        }
      }
    }

    // Check edge snapping
    if (this.snapToEdges && !closestSnap.snapped) {
      for (const feature of relevantFeatures) {
        const edges = this.extractEdges(feature);

        edges.forEach((edge, edgeIndex) => {
          const nearestPoint = nearestPointOnLine(point, edge);
          const pixelDist = pixelDistance(this.map!, point, nearestPoint);

          if (pixelDist < minPixelDistance) {
            minPixelDistance = pixelDist;
            closestSnap = {
              snapped: true,
              point: nearestPoint,
              feature,
              edgeIndex
            };
          }
        });
      }
    }

    return closestSnap;
  }

  private extractVertices(feature: EditorFeature): Position[] {
    const vertices: Position[] = [];
    const pushIfValid = (position: Position) => {
      if (isValidPosition(position)) {
        vertices.push(position);
      }
    };

    if (feature.geometry.type === 'Point') {
      pushIfValid(feature.geometry.coordinates as Position);
    } else if (feature.geometry.type === 'LineString') {
      const coords = feature.geometry.coordinates as Position[];
      coords.forEach(pushIfValid);
    } else if (feature.geometry.type === 'Polygon') {
      const rings = feature.geometry.coordinates as Position[][];
      rings.forEach(ring => ring.forEach(pushIfValid));
    } else if (feature.geometry.type === 'MultiPoint') {
      const coords = feature.geometry.coordinates as Position[];
      coords.forEach(pushIfValid);
    } else if (feature.geometry.type === 'MultiLineString') {
      const lines = feature.geometry.coordinates as Position[][];
      lines.forEach(line => line.forEach(pushIfValid));
    } else if (feature.geometry.type === 'MultiPolygon') {
      const polygons = feature.geometry.coordinates as Position[][][];
      polygons.forEach(polygon => {
        polygon.forEach(ring => ring.forEach(pushIfValid));
      });
    }

    return vertices;
  }

  private extractEdges(feature: EditorFeature): Position[][] {
    const edges: Position[][] = [];

    if (feature.geometry.type === 'LineString') {
      const coords = feature.geometry.coordinates as Position[];
      for (let i = 0; i < coords.length - 1; i++) {
        if (isValidPosition(coords[i]) && isValidPosition(coords[i + 1])) {
          edges.push([coords[i], coords[i + 1]]);
        }
      }
    } else if (feature.geometry.type === 'Polygon') {
      const rings = feature.geometry.coordinates as Position[][];
      rings.forEach(ring => {
        for (let i = 0; i < ring.length - 1; i++) {
          if (isValidPosition(ring[i]) && isValidPosition(ring[i + 1])) {
            edges.push([ring[i], ring[i + 1]]);
          }
        }
      });
    } else if (feature.geometry.type === 'MultiLineString') {
      const lines = feature.geometry.coordinates as Position[][];
      lines.forEach(line => {
        for (let i = 0; i < line.length - 1; i++) {
          if (isValidPosition(line[i]) && isValidPosition(line[i + 1])) {
            edges.push([line[i], line[i + 1]]);
          }
        }
      });
    } else if (feature.geometry.type === 'MultiPolygon') {
      const polygons = feature.geometry.coordinates as Position[][][];
      polygons.forEach(polygon => {
        polygon.forEach(ring => {
          for (let i = 0; i < ring.length - 1; i++) {
            if (isValidPosition(ring[i]) && isValidPosition(ring[i + 1])) {
              edges.push([ring[i], ring[i + 1]]);
            }
          }
        });
      });
    }

    return edges;
  }
}
