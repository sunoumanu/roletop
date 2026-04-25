/**
 * WebRTC (review item #9).
 *
 * The phase-5 RTC panel was cosmetic — "SIMULATED" tiles that misled players.
 * In phase 6 the panel is hidden by default; set `VITE_ENABLE_RTC_DEMO=1` at
 * build time to render it, and when rendered it carries a prominent
 * `DEMO — NOT A REAL CALL` tag so no one expects click-to-call.
 *
 * The production direction (Jitsi / LiveKit / PeerJS) lives as a TODO below —
 * when it's built, delete this file's body and implement the Transport from
 * a real SDK.
 */

export const RTC_DEMO_ENABLED = String(import.meta.env.VITE_ENABLE_RTC_DEMO ?? '').length > 0;

export interface RtcParticipant {
  id: string;
  name: string;
  color: string;
  muted: boolean;
  speaking: boolean;
  camOn: boolean;
}

/**
 * TODO(rtc): real implementation plan.
 *
 *   - Pick one transport: LiveKit (managed, simplest) or PeerJS (self-hosted,
 *     mesh). Jitsi is viable but the SDK is heavier.
 *   - Provide a `createRtcTransport()` returning:
 *        { join(roomId), leave(), on('participant', fn), muteSelf(), ... }
 *   - Render each participant with a real <video> element fed by MediaStream.
 *   - Keep the demo panel under a feature flag until the above is wired.
 */

export function rtcStatusLabel(): string {
  return RTC_DEMO_ENABLED ? 'DEMO — NOT A REAL CALL' : 'DISABLED';
}

export const demoParticipants: RtcParticipant[] = [
  { id: 'p1', name: 'Aldric', color: '#2a6a9a', muted: false, speaking: false, camOn: false },
  { id: 'p2', name: 'Mira',   color: '#8a5a2a', muted: true,  speaking: false, camOn: false },
  { id: 'p3', name: 'Vayne',  color: '#4a8a5a', muted: false, speaking: false, camOn: false }
];
