/**
 * AoE template math (review item #6).
 *
 * Each template carries an origin, shape-specific size in feet, and (for
 * cone/line) an angle. `tokenInside` tells the renderer / rules layer
 * which tokens are currently highlighted as "affected".
 *
 * Shapes:
 *   sphere — circle of radius R ft centred on origin
 *   cube   — square of side 2R ft centred on origin (axis-aligned)
 *   line   — segment of length L ft from origin at angle, 5 ft wide (half cell)
 *   cone   — 53° cone (D&D approximation ~ 1/7 circle) from origin, length L
 */
import { ftToPx } from './grid';
import type { AoETemplate } from '../state/schemas';
import type { Token } from '../state/schemas';

const CONE_HALF = (Math.PI / 180) * 26.5; // ~53° total
const LINE_HALF_WIDTH_PX = ftToPx(2.5);    // half a grid cell

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function tokenInside(t: Pick<Token, 'wx' | 'wy'>, tpl: AoETemplate): boolean {
  const dx = t.wx - tpl.originX;
  const dy = t.wy - tpl.originY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const sizePx = ftToPx(tpl.sizeFt);

  switch (tpl.shape) {
    case 'sphere':
      return dist <= sizePx;
    case 'cube':
      return Math.abs(dx) <= sizePx && Math.abs(dy) <= sizePx;
    case 'line': {
      // Rotate (dx, dy) into the template's local frame.
      const cos = Math.cos(-tpl.angle);
      const sin = Math.sin(-tpl.angle);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return lx >= 0 && lx <= sizePx && Math.abs(ly) <= LINE_HALF_WIDTH_PX;
    }
    case 'cone': {
      if (dist > sizePx) return false;
      const ta = Math.atan2(dy, dx);
      return Math.abs(angleDiff(ta, tpl.angle)) <= CONE_HALF;
    }
    default:
      return false;
  }
}

/**
 * Build the closed polygon describing the template in world-space.
 * Renderer fills this path; also used by tokenInside callers that need a
 * visual mask rather than a point test.
 */
export function templatePath(tpl: AoETemplate): Path2D {
  const p = new Path2D();
  const sizePx = ftToPx(tpl.sizeFt);
  switch (tpl.shape) {
    case 'sphere':
      p.arc(tpl.originX, tpl.originY, sizePx, 0, Math.PI * 2);
      break;
    case 'cube':
      p.rect(tpl.originX - sizePx, tpl.originY - sizePx, sizePx * 2, sizePx * 2);
      break;
    case 'line': {
      const cos = Math.cos(tpl.angle);
      const sin = Math.sin(tpl.angle);
      // local rectangle with corners (0, ±w) and (L, ±w)
      const corners = [
        { lx: 0, ly: -LINE_HALF_WIDTH_PX },
        { lx: sizePx, ly: -LINE_HALF_WIDTH_PX },
        { lx: sizePx, ly: LINE_HALF_WIDTH_PX },
        { lx: 0, ly: LINE_HALF_WIDTH_PX }
      ];
      corners.forEach((c, i) => {
        const wx = tpl.originX + c.lx * cos - c.ly * sin;
        const wy = tpl.originY + c.lx * sin + c.ly * cos;
        if (i === 0) p.moveTo(wx, wy);
        else p.lineTo(wx, wy);
      });
      p.closePath();
      break;
    }
    case 'cone': {
      const a1 = tpl.angle - CONE_HALF;
      const a2 = tpl.angle + CONE_HALF;
      p.moveTo(tpl.originX, tpl.originY);
      p.lineTo(tpl.originX + Math.cos(a1) * sizePx, tpl.originY + Math.sin(a1) * sizePx);
      p.arc(tpl.originX, tpl.originY, sizePx, a1, a2);
      p.closePath();
      break;
    }
  }
  return p;
}

export const AOE_DEFAULT_SIZES: Record<AoETemplate['shape'], number> = {
  sphere: 20,
  cube: 10,
  line: 30,
  cone: 15
};
