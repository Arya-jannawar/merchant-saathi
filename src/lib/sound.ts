"use client";

/**
 * Tiny synthesized sound kit for the demo UI and the Saathi mascot.
 *
 * Everything is generated with the Web Audio API at runtime - no audio files,
 * no downloads, nothing loaded from the network. Volumes stay low (the loudest
 * peak is under 0.12 gain) and the whole kit can be muted; the preference is
 * remembered per browser in localStorage.
 */

export type SoundName =
  | "tap" // generic button press
  | "hover" // subtle tick on pointer enter
  | "open" // drawer/dialog pops open
  | "close" // drawer/dialog closes
  | "send" // chat message sent
  | "reply" // chat reply arrives
  | "success" // approval / safe offer
  | "warn" // unsafe offer / 409 banner
  | "error" // request failed
  | "celebrate" // campaign queued / results landed
  | "step" // guided-tour step advance
  | "jingle" // mascot greeting
  | "giggle" // mascot being playful
  | "sad" // mascot sympathy
  | "toggle"; // sound on/off switch

const STORAGE_KEY = "ms_sound_enabled";

class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private listeners = new Set<(enabled: boolean) => void>();
  private _enabled: boolean;

  constructor() {
    if (typeof window === "undefined") {
      this._enabled = false;
      return;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    this._enabled = stored === null ? true : stored === "1";
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(next: boolean): void {
    this._enabled = next;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    }
    this.listeners.forEach((fn) => fn(next));
    if (next) this.play("toggle");
  }

  subscribe(fn: (enabled: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Browsers start an AudioContext suspended until a user gesture happens. */
  private ensureContext(): AudioContext | null {
    if (!this._enabled || typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  play(name: SoundName): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    for (const note of SCORES[name]) {
      this.note(ctx, now + note.at, note);
    }
  }

  private note(ctx: AudioContext, at: number, spec: NoteSpec): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.type ?? "sine";
    osc.frequency.setValueAtTime(spec.f0, at);
    if (spec.f1 !== undefined && spec.f1 !== spec.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(spec.f1, 1), at + spec.dur);
    }
    const peak = spec.gain ?? 0.08;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, spec.dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.dur);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(at);
    osc.stop(at + spec.dur + 0.02);
  }
}

interface NoteSpec {
  at: number;
  dur: number;
  f0: number;
  f1?: number;
  type?: OscillatorType;
  gain?: number;
}

/**
 * Each score is a handful of short notes. Values were picked by ear against
 * two constraints: everything stays within a comfortable treble range, and no
 * score runs longer than ~1.2s so interactions never feel delayed.
 */
const SCORES: Record<SoundName, NoteSpec[]> = {
  tap: [{ at: 0, dur: 0.09, f0: 520, f1: 380, type: "triangle", gain: 0.07 }],
  hover: [{ at: 0, dur: 0.05, f0: 880, type: "sine", gain: 0.022 }],
  open: [
    { at: 0, dur: 0.08, f0: 480, f1: 700, type: "triangle", gain: 0.07 },
    { at: 0.06, dur: 0.1, f0: 760, f1: 980, type: "triangle", gain: 0.06 },
  ],
  close: [
    { at: 0, dur: 0.09, f0: 660, f1: 420, type: "triangle", gain: 0.06 },
    { at: 0.07, dur: 0.09, f0: 400, f1: 260, type: "triangle", gain: 0.05 },
  ],
  send: [{ at: 0, dur: 0.12, f0: 620, f1: 1180, type: "sine", gain: 0.08 }],
  reply: [
    { at: 0, dur: 0.1, f0: 700, type: "sine", gain: 0.07 },
    { at: 0.1, dur: 0.14, f0: 940, type: "sine", gain: 0.06 },
  ],
  success: [
    { at: 0, dur: 0.1, f0: 660, type: "sine", gain: 0.075 },
    { at: 0.09, dur: 0.12, f0: 880, type: "sine", gain: 0.075 },
    { at: 0.2, dur: 0.18, f0: 1320, type: "sine", gain: 0.06 },
  ],
  warn: [
    { at: 0, dur: 0.12, f0: 330, f1: 290, type: "square", gain: 0.035 },
    { at: 0.14, dur: 0.14, f0: 290, f1: 250, type: "square", gain: 0.035 },
  ],
  error: [
    { at: 0, dur: 0.16, f0: 240, f1: 150, type: "sawtooth", gain: 0.045 },
    { at: 0.18, dur: 0.16, f0: 190, f1: 120, type: "sawtooth", gain: 0.04 },
  ],
  celebrate: [
    { at: 0, dur: 0.1, f0: 523, type: "triangle", gain: 0.08 },
    { at: 0.08, dur: 0.1, f0: 659, type: "triangle", gain: 0.08 },
    { at: 0.16, dur: 0.1, f0: 784, type: "triangle", gain: 0.08 },
    { at: 0.24, dur: 0.22, f0: 1046, type: "triangle", gain: 0.09 },
    { at: 0.34, dur: 0.16, f0: 1318, type: "sine", gain: 0.05 },
  ],
  step: [{ at: 0, dur: 0.07, f0: 720, f1: 980, type: "sine", gain: 0.05 }],
  jingle: [
    { at: 0, dur: 0.1, f0: 523, type: "triangle", gain: 0.06 },
    { at: 0.1, dur: 0.1, f0: 659, type: "triangle", gain: 0.06 },
    { at: 0.2, dur: 0.1, f0: 784, type: "triangle", gain: 0.06 },
    { at: 0.3, dur: 0.24, f0: 1046, f1: 1174, type: "triangle", gain: 0.07 },
  ],
  giggle: [
    { at: 0, dur: 0.06, f0: 990, f1: 1240, type: "sine", gain: 0.045 },
    { at: 0.08, dur: 0.06, f0: 1100, f1: 860, type: "sine", gain: 0.045 },
    { at: 0.16, dur: 0.06, f0: 1240, f1: 990, type: "sine", gain: 0.045 },
  ],
  sad: [
    { at: 0, dur: 0.18, f0: 440, f1: 330, type: "triangle", gain: 0.05 },
    { at: 0.2, dur: 0.26, f0: 330, f1: 233, type: "triangle", gain: 0.05 },
  ],
  toggle: [{ at: 0, dur: 0.07, f0: 620, f1: 840, type: "sine", gain: 0.05 }],
};

/** Singleton: one AudioContext for the whole app, created lazily on first gesture. */
export const soundKit = new SoundKit();
