/**
 * Grid abstraction — currently square-only, but all other modules use this
 * interface so swapping to hex/gridless in phase 7 is localised here.
 */
export const GRID_SIZE = 70;
export const MAP_W = 1400;
export const MAP_H = 1050;
export const FEET_PER_CELL = 5;

export function snap(wx: number, wy: number): { wx: number; wy: number } {
  return {
    wx: Math.floor(wx / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2,
    wy: Math.floor(wy / GRID_SIZE) * GRID_SIZE + GRID_SIZE / 2
  };
}

/** Distance in feet between two world-space positions (5-5-5 chessboard rule). */
export function distanceFt(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx) / GRID_SIZE;
  const dy = Math.abs(ay - by) / GRID_SIZE;
  return Math.max(dx, dy) * FEET_PER_CELL;
}

/** Euclidean (strict pythagorean) distance — still available where true range matters. */
export function distanceEuclideanFt(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return (Math.sqrt(dx * dx + dy * dy) / GRID_SIZE) * FEET_PER_CELL;
}

export function ftToPx(ft: number): number {
  return (ft / FEET_PER_CELL) * GRID_SIZE;
}

/** Number of cells on each axis of the map (square grid). */
export const MAP_CELLS_X = Math.ceil(MAP_W / GRID_SIZE);
export const MAP_CELLS_Y = Math.ceil(MAP_H / GRID_SIZE);

/** World → cell-coordinate conversion. */
export function cellAt(wx: number, wy: number): { cx: number; cy: number } {
  return { cx: Math.floor(wx / GRID_SIZE), cy: Math.floor(wy / GRID_SIZE) };
}

/** Stable string key for a cell, used by the manual fog set. */
export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Expand an axis-aligned world-space rectangle into the set of cells it
 * covers. Coordinates do not need to be in min/max order.
 * Used by the manual fog brush (§2 #7) and any future rectangle-tool.
 */
export function cellsInRect(ax: number, ay: number, bx: number, by: number): string[] {
  const a = cellAt(Math.min(ax, bx), Math.min(ay, by));
  const b = cellAt(Math.max(ax, bx), Math.max(ay, by));
  const out: string[] = [];
  for (let cy = a.cy; cy <= b.cy; cy++) {
    for (let cx = a.cx; cx <= b.cx; cx++) {
      if (cx < 0 || cy < 0 || cx >= MAP_CELLS_X || cy >= MAP_CELLS_Y) continue;
      out.push(cellKey(cx, cy));
    }
  }
  return out;
}
