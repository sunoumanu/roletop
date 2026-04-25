/// <reference lib="webworker" />
/**
 * Visibility compute worker.
 *
 * Runs `computeVisibility` off the main thread so the raycaster doesn't stall
 * input handling when a scene has 500+ walls or the viewer is lerping fast.
 * The worker owns its own module-scope copy of the visibility cache (the
 * cache lives in `walls.ts` — each thread gets an independent one), so it
 * can internally amortise repeated requests from the same viewer position
 * without a round-trip to the main thread.
 *
 * Message protocol — kept deliberately small to keep structured-clone cheap:
 *
 *   main → worker : { kind: 'compute', seq, walls, ox, oy, vr }
 *   worker → main : { kind: 'result',  seq, result }
 *
 * `seq` is a monotonically increasing request id so the provider can drop
 * stale responses when the caller has already asked for a newer frame.
 */
import type { Wall } from '../state/schemas';
import { computeVisibility, type VisibilityResult } from './walls';

export interface ComputeRequest {
  kind: 'compute';
  seq: number;
  walls: Wall[];
  ox: number;
  oy: number;
  vr: number;
}

export interface ComputeResponse {
  kind: 'result';
  seq: number;
  result: VisibilityResult;
}

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', (ev: MessageEvent<ComputeRequest>) => {
  const msg = ev.data;
  if (!msg || msg.kind !== 'compute') return;
  const result = computeVisibility(msg.walls, msg.ox, msg.oy, msg.vr);
  const resp: ComputeResponse = { kind: 'result', seq: msg.seq, result };
  self.postMessage(resp);
});
