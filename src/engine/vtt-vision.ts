import { CombatantNode, TerrainCell } from '../types/combat';
import { sizeToGridCells } from './dm-tools';

function isCellBlocked(x: number, y: number, wallSet: Set<string>): boolean {
  return wallSet.has(`${x},${y}`);
}

/**
 * Supercover / Bresenham-style grid raycast from (x0, y0) to (x1, y1).
 * The origin cell is always visible; any intermediate wall blocks further cells,
 * while the wall cell itself is visible (so players see the wall face).
 */
function hasLineOfSight(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  wallSet: Set<string>
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return true;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.round(x0 + dx * t);
    const cy = Math.round(y0 + dy * t);
    if (cx === x1 && cy === y1) return true;
    if (isCellBlocked(cx, cy, wallSet)) return false;
  }
  return true;
}

export function computeVisibleCells(
  combatants: CombatantNode[],
  cols: number,
  rows: number,
  gridFeet: number,
  terrainCells: TerrainCell[] = []
): Set<string> {
  const visible = new Set<string>();
  const wallSet = new Set<string>();
  for (const cell of terrainCells) {
    if (cell.kind === 'wall') wallSet.add(`${cell.x},${cell.y}`);
  }

  const viewers = combatants.filter(
    (c) => (c.kind === 'pc' || c.kind === 'summon') && !c.hidden && c.hp.current > 0
  );
  if (viewers.length === 0) return visible;

  const safeGridFeet = Math.max(5, gridFeet || 5);

  for (const viewer of viewers) {
    const span = sizeToGridCells(viewer.size);
    const vx = (viewer.x ?? 0) + (span - 1) / 2;
    const vy = (viewer.y ?? 0) + (span - 1) / 2;
    const radiusCells = Math.max(1, Math.ceil((viewer.visionFeet ?? 60) / safeGridFeet));

    const minX = Math.max(0, Math.floor(vx - radiusCells));
    const maxX = Math.min(cols - 1, Math.ceil(vx + radiusCells));
    const minY = Math.max(0, Math.floor(vy - radiusCells));
    const maxY = Math.min(rows - 1, Math.ceil(vy + radiusCells));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.hypot(x - vx, y - vy);
        if (dist > radiusCells + 0.35) continue;
        if (hasLineOfSight(Math.round(vx), Math.round(vy), x, y, wallSet)) {
          visible.add(`${x},${y}`);
        }
      }
    }
  }

  return visible;
}
