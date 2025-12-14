import type { HistoryAction, EditorFeature, IManager } from '../types';
import type { Map } from 'maplibre-gl';

export class HistoryManager implements IManager {
  private history: HistoryAction[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 100;
  private map?: Map;

  constructor(maxHistorySize: number = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  onAdd(map: Map): void {
    this.map = map;
  }

  onRemove(): void {
    this.clear();
  }

  addAction(action: HistoryAction): void {
    // Remove any actions after current index (if we've undone)
    this.history = this.history.slice(0, this.currentIndex + 1);

    // Add new action
    this.history.push(action);
    this.currentIndex++;

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
      this.currentIndex--;
    }
  }

  recordCreate(features: EditorFeature[]): void {
    this.addAction({
      type: 'create',
      features: features.map(f => ({ ...f })),
      timestamp: Date.now()
    });
  }

  recordUpdate(features: EditorFeature[], previousFeatures: EditorFeature[]): void {
    this.addAction({
      type: 'update',
      features: features.map(f => ({ ...f })),
      previousFeatures: previousFeatures.map(f => ({ ...f })),
      timestamp: Date.now()
    });
  }

  recordDelete(features: EditorFeature[]): void {
    this.addAction({
      type: 'delete',
      features: features.map(f => ({ ...f })),
      timestamp: Date.now()
    });
  }

  canUndo(): boolean {
    return this.currentIndex >= 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  undo(): HistoryAction | null {
    if (!this.canUndo()) {
      return null;
    }

    const action = this.history[this.currentIndex];
    this.currentIndex--;
    return action;
  }

  redo(): HistoryAction | null {
    if (!this.canRedo()) {
      return null;
    }

    this.currentIndex++;
    const action = this.history[this.currentIndex];
    return action;
  }

  clear(): void {
    this.history = [];
    this.currentIndex = -1;
  }

  getHistory(): HistoryAction[] {
    return [...this.history];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }
}