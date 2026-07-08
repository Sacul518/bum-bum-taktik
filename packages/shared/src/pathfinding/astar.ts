import type { Domain } from '../types.js';
import { isWalkable, type WalkabilityGrids } from '../procgen/walkability.js';

export interface GridPoint {
  x: number;
  y: number;
}

// dx, dy, Bewegungskosten (1 orthogonal, Wurzel(2) diagonal).
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

// Octile-Distanz: zulaessige (nie ueberschaetzende) Heuristik fuer eine
// 8er-Nachbarschaft mit Diagonalkosten Wurzel(2) - liefert engere Schaetzungen
// als Manhattan- oder Euklidische Distanz und haelt A* dadurch schneller.
function heuristic(a: GridPoint, b: GridPoint): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

// Simple Array-Binaerheap, da Node keine eingebaute Prioritaetswarteschlange
// hat. Eintraege werden lazy geloescht (siehe visited-Check im Aufrufer)
// statt sie beim Update zu entfernen - einfacher als ein Index-basiertes
// Decrease-Key und fuer Kartengroessen hier schnell genug.
class MinHeap {
  private readonly nodes: { index: number; priority: number }[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(index: number, priority: number): void {
    this.nodes.push({ index, priority });
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.nodes[parent]!.priority <= this.nodes[i]!.priority) break;
      [this.nodes[parent]!, this.nodes[i]!] = [this.nodes[i]!, this.nodes[parent]!];
      i = parent;
    }
  }

  pop(): number | undefined {
    const top = this.nodes[0];
    if (!top) return undefined;
    const last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      let i = 0;
      const n = this.nodes.length;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < n && this.nodes[left]!.priority < this.nodes[smallest]!.priority) smallest = left;
        if (right < n && this.nodes[right]!.priority < this.nodes[smallest]!.priority) smallest = right;
        if (smallest === i) break;
        [this.nodes[smallest]!, this.nodes[i]!] = [this.nodes[i]!, this.nodes[smallest]!];
        i = smallest;
      }
    }
    return top.index;
  }
}

function reconstructPath(cameFrom: Int32Array, width: number, goalIndex: number): GridPoint[] {
  const path: GridPoint[] = [];
  let current = goalIndex;
  while (current !== -1) {
    path.push({ x: current % width, y: Math.floor(current / width) });
    current = cameFrom[current] ?? -1;
  }
  path.reverse();
  return path;
}

/**
 * A* auf dem Begehbarkeits-Raster einer einzelnen Domain. Gibt die Kachel-
 * Mittelpunkte vom Start (exklusive) bis zum Ziel zurueck, oder null, wenn
 * kein Pfad existiert (z. B. Ziel liegt in einer anderen Domain oder ist
 * durch Wasser/Berge vom Start getrennt).
 */
export function findPath(grids: WalkabilityGrids, domain: Domain, start: GridPoint, goal: GridPoint): GridPoint[] | null {
  const { width, height } = grids;
  if (!isWalkable(grids, domain, start.x, start.y) || !isWalkable(grids, domain, goal.x, goal.y)) {
    return null;
  }

  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;
  if (startIndex === goalIndex) return [];

  const cellCount = width * height;
  const cameFrom = new Int32Array(cellCount).fill(-1);
  const gScore = new Float64Array(cellCount).fill(Infinity);
  const visited = new Uint8Array(cellCount);

  gScore[startIndex] = 0;
  const open = new MinHeap();
  open.push(startIndex, heuristic(start, goal));

  while (open.size > 0) {
    const current = open.pop()!;
    if (visited[current]) continue;
    if (current === goalIndex) return reconstructPath(cameFrom, width, current).slice(1);
    visited[current] = 1;

    const cx = current % width;
    const cy = Math.floor(current / width);

    for (const [dx, dy, cost] of NEIGHBOR_OFFSETS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!isWalkable(grids, domain, nx, ny)) continue;

      // Diagonalen nicht durch zwei blockierte Ecken "schneiden" lassen -
      // sonst liefe eine Einheit scheinbar durch die Ecke einer Bergkette.
      if (dx !== 0 && dy !== 0 && (!isWalkable(grids, domain, cx + dx, cy) || !isWalkable(grids, domain, cx, cy + dy))) {
        continue;
      }

      const neighborIndex = ny * width + nx;
      if (visited[neighborIndex]) continue;

      const tentativeG = (gScore[current] as number) + cost;
      if (tentativeG < (gScore[neighborIndex] as number)) {
        gScore[neighborIndex] = tentativeG;
        cameFrom[neighborIndex] = current;
        open.push(neighborIndex, tentativeG + heuristic({ x: nx, y: ny }, goal));
      }
    }
  }

  return null;
}
