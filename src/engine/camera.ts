/**
 * Camera (pan + zoom).
 *
 * Same math as phase-5 but lifted out of the renderer so the input layer and
 * the renderer can share one instance without reaching through globals.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  readonly minZoom = 0.2;
  readonly maxZoom = 4;

  worldToScreen(wx: number, wy: number, W: number, H: number): { sx: number; sy: number } {
    return {
      sx: (wx - this.x) * this.zoom + W / 2,
      sy: (wy - this.y) * this.zoom + H / 2
    };
  }

  screenToWorld(sx: number, sy: number, W: number, H: number): { wx: number; wy: number } {
    return {
      wx: (sx - W / 2) / this.zoom + this.x,
      wy: (sy - H / 2) / this.zoom + this.y
    };
  }

  applyTransform(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  restoreTransform(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  zoomAt(factor: number, sx: number, sy: number, W: number, H: number): void {
    const wx = (sx - W / 2) / this.zoom + this.x;
    const wy = (sy - H / 2) / this.zoom + this.y;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.x = wx - (sx - W / 2) / this.zoom;
    this.y = wy - (sy - H / 2) / this.zoom;
  }

  fit(W: number, H: number, mapW: number, mapH: number): void {
    this.x = mapW / 2;
    this.y = mapH / 2;
    this.zoom = Math.min(W / mapW, H / mapH) * 0.9;
  }
}

export const camera = new Camera();
