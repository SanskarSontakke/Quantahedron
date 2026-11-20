/**
 * Subtle audio resonance for the de Broglie ring (PRD, Sim 2).
 *
 * The instant 2πr = nλ snaps into a standing wave, a ~300 ms three-partial chime
 * marks the lock. There is no asset, no autoplay and no state: browsers only
 * release an AudioContext after a user gesture, and a lock is only reachable by
 * dragging a slider or running a tour, so the first interaction is always the
 * user's. Audio is garnish — every path is guarded and nothing here may throw
 * into the animation clock.
 */

let ctx: AudioContext | null = null;
let lastAt = -1e9;

type AudioCtor = typeof AudioContext;

function ctor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: AudioCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Pitch rises with the winding number: n = 1 is a low G, each n a minor third up. */
function pitchFor(n: number): number {
  const step = Math.min(12, Math.max(0, Math.round(n) - 1));
  return 196 * Math.pow(2, step / 3);
}

export function chime(n: number, level = 1): void {
  if (!(level > 0)) return;
  const AC = ctor();
  if (!AC) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastAt < 140) return; // one chime per snap, never one per frame
  lastAt = now;
  try {
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.055 * Math.min(1, level), t + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    env.connect(ctx.destination);
    for (const [mult, amp] of [
      [1, 1],
      [2, 0.4],
      [3, 0.13],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = pitchFor(n) * mult;
      const mix = ctx.createGain();
      mix.gain.value = amp;
      osc.connect(mix);
      mix.connect(env);
      osc.start(t);
      osc.stop(t + 0.36);
    }
  } catch {
    /* a blocked or exhausted audio device must not affect the simulation */
    ctx = null;
  }
}

/** Release the context when the viewport unmounts. */
export function releaseChime(): void {
  const dying = ctx;
  ctx = null;
  if (dying) void dying.close().catch(() => undefined);
}
