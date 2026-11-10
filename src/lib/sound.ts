"use client";

/**
 * Synthesized sound kit for the demo UI and the mascot cast.
 *
 * Everything is generated at runtime with the Web Audio API - no audio files,
 * nothing downloaded. A compressor on the master bus keeps the mix glued, and
 * every mascot has a distinct voice profile (waveform + transposition + tempo +
 * closing flourish) so mascot x mood pairs are recognizable by ear alone.
 * Volumes stay low and the whole kit can be muted (persisted per browser).
 */

import { getMascot, type MascotId, type SignatureMood } from "@/lib/mascots-config";

export type SoundName =
  | "tap"
  | "hover"
  | "open"
  | "close"
  | "send"
  | "reply"
  | "success"
  | "warn"
  | "error"
  | "celebrate"
  | "step"
  | "jingle"
  | "giggle"
  | "sad"
  | "toggle"
  | "switch" // business switched
  | "addBusiness" // new business created
  | "removeBusiness"; // business deleted

const STORAGE_KEY = "ms_sound_enabled";
const SEMITONE = Math.pow(2, 1 / 12);

class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
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
      // Master bus: gentle gain into a compressor keeps overlapping jingles
      // from clipping while staying punchy.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private note(ctx: AudioContext, at: number, spec: NoteSpec): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.type ?? "sine";
    osc.frequency.setValueAtTime(Math.max(spec.f0, 1), at);
    if (spec.f1 !== undefined && spec.f1 !== spec.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(spec.f1, 1), at + spec.dur);
    }
    // Quick vibrato makes jingles feel sung rather than beeped.
    if (spec.vibrato) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = spec.vibrato.hz;
      lfoGain.gain.value = spec.vibrato.cents;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(at);
      lfo.stop(at + spec.dur + 0.05);
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

  /** Filtered noise burst - the "whoosh"/"steam" texture layer. */
  private noise(ctx: AudioContext, at: number, dur: number, opts: { f0: number; f1: number; gain?: number; q?: number }): void {
    if (!this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = opts.q ?? 1.2;
    filter.frequency.setValueAtTime(opts.f0, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(opts.f1, 1), at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.045, at + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  play(name: SoundName): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const note of SCORES[name].notes) this.note(ctx, now + note.at, note);
    for (const nz of SCORES[name].noise ?? []) this.noise(ctx, now + nz.at, nz.dur, nz);
  }

  /**
   * A mascot's signature mood jingle: the mood's melody run through that
   * mascot's voice (waveform, transposition, tempo) and finished with its
   * unique flourish. Every mascot x mood pair sounds different.
   */
  playMascot(mascotId: MascotId, mood: SignatureMood): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const mascot = getMascot(mascotId);
    const voice = mascot.voice;
    const scale = Math.pow(SEMITONE, voice.transpose);
    const tempo = voice.tempo;
    const melody = MOOD_MELODIES[mood];
    const now = ctx.currentTime;
    melody.notes.forEach((step) => {
      this.note(ctx, now + step.at / tempo, {
        ...step,
        f0: step.f0 * scale,
        f1: step.f1 !== undefined ? step.f1 * scale : undefined,
        type: voice.wave,
        gain: Math.min((step.gain ?? 0.07) * (voice.wave === "square" || voice.wave === "sawtooth" ? 0.55 : 1), 0.09),
        vibrato: voice.flourish === "swirl" ? { hz: 6, cents: 45 } : undefined,
      });
    });
    const t0 = now + melody.notes[melody.notes.length - 1].at / tempo;
    this.flourish(ctx, t0, voice.flourish, scale);
  }

  private flourish(ctx: AudioContext, at: number, kind: string, scale: number): void {
    switch (kind) {
      case "sparkle":
        [1568, 2093, 2637].forEach((f, i) =>
          this.note(ctx, at + i * 0.05, { at: 0, dur: 0.14, f0: f * scale, type: "sine", gain: 0.045 })
        );
        break;
      case "pop":
        this.note(ctx, at, { at: 0, dur: 0.09, f0: 660 * scale, f1: 220 * scale, type: "square", gain: 0.05 });
        this.noise(ctx, at, 0.08, { f0: 1800, f1: 500, gain: 0.04, q: 2 });
        break;
      case "steam":
        this.noise(ctx, at, 0.42, { f0: 600, f1: 2400, gain: 0.05, q: 0.9 });
        this.note(ctx, at + 0.05, { at: 0, dur: 0.3, f0: 1046 * scale, f1: 1568 * scale, type: "triangle", gain: 0.04 });
        break;
      case "coin":
        this.note(ctx, at, { at: 0, dur: 0.22, f0: 2093 * scale, type: "sine", gain: 0.06 });
        this.note(ctx, at + 0.07, { at: 0, dur: 0.3, f0: 2794 * scale, type: "sine", gain: 0.05 });
        break;
      case "bounce":
        [392, 523, 392].forEach((f, i) =>
          this.note(ctx, at + i * 0.09, { at: 0, dur: 0.1, f0: f * scale, f1: f * scale * 0.72, type: "triangle", gain: 0.06 })
        );
        break;
      case "swirl":
        this.note(ctx, at, { at: 0, dur: 0.45, f0: 784 * scale, f1: 1175 * scale, type: "sawtooth", gain: 0.035, vibrato: { hz: 8, cents: 70 } });
        break;
    }
  }
}

interface NoteSpec {
  at: number;
  dur: number;
  f0: number;
  f1?: number;
  type?: OscillatorType;
  gain?: number;
  vibrato?: { hz: number; cents: number };
}

interface NoiseSpec {
  at: number;
  dur: number;
  f0: number;
  f1: number;
  gain?: number;
  q?: number;
}

const n = (at: number, dur: number, f0: number, f1?: number, type?: OscillatorType, gain?: number): NoteSpec => ({
  at,
  dur,
  f0,
  f1,
  type,
  gain,
});

/**
 * UI scorebook. Short, treble-heavy, low-gain - picked by ear with two rules:
 * nothing runs longer than ~1.2s and no interaction waits on audio.
 */
const SCORES: Record<SoundName, { notes: NoteSpec[]; noise?: NoiseSpec[] }> = {
  tap: { notes: [n(0, 0.09, 520, 380, "triangle", 0.07)] },
  hover: { notes: [n(0, 0.05, 880, undefined, "sine", 0.02)] },
  open: {
    notes: [n(0, 0.08, 480, 700, "triangle", 0.06), n(0.06, 0.1, 760, 980, "triangle", 0.055)],
    noise: [{ at: 0, dur: 0.18, f0: 500, f1: 2200, gain: 0.025, q: 1.5 }],
  },
  close: {
    notes: [n(0, 0.09, 660, 420, "triangle", 0.055), n(0.07, 0.09, 400, 260, "triangle", 0.05)],
    noise: [{ at: 0, dur: 0.16, f0: 1800, f1: 500, gain: 0.02, q: 1.5 }],
  },
  send: { notes: [n(0, 0.12, 620, 1180, "sine", 0.08)] },
  reply: { notes: [n(0, 0.1, 700, undefined, "sine", 0.07), n(0.1, 0.14, 940, undefined, "sine", 0.06)] },
  success: {
    notes: [n(0, 0.1, 659, undefined, "sine", 0.07), n(0.09, 0.12, 880, undefined, "sine", 0.07), n(0.2, 0.2, 1318, undefined, "sine", 0.055)],
    noise: [{ at: 0.2, dur: 0.22, f0: 3000, f1: 6000, gain: 0.014, q: 2.5 }],
  },
  warn: {
    notes: [n(0, 0.12, 330, 290, "square", 0.032), n(0.14, 0.14, 290, 250, "square", 0.032)],
  },
  error: { notes: [n(0, 0.16, 240, 150, "sawtooth", 0.04), n(0.18, 0.16, 190, 120, "sawtooth", 0.038)] },
  celebrate: {
    notes: [
      n(0, 0.1, 523, undefined, "triangle", 0.08),
      n(0.08, 0.1, 659, undefined, "triangle", 0.08),
      n(0.16, 0.1, 784, undefined, "triangle", 0.08),
      n(0.24, 0.22, 1046, undefined, "triangle", 0.09),
      n(0.34, 0.18, 1318, undefined, "sine", 0.05),
      n(0.46, 0.22, 1568, undefined, "sine", 0.045),
    ],
    noise: [{ at: 0.24, dur: 0.4, f0: 2500, f1: 6500, gain: 0.02, q: 2 }],
  },
  step: { notes: [n(0, 0.07, 720, 980, "sine", 0.05)] },
  jingle: {
    notes: [n(0, 0.1, 523, undefined, "triangle", 0.06), n(0.1, 0.1, 659, undefined, "triangle", 0.06), n(0.2, 0.1, 784, undefined, "triangle", 0.06), n(0.3, 0.24, 1046, 1174, "triangle", 0.07)],
    noise: [{ at: 0.3, dur: 0.2, f0: 2800, f1: 5200, gain: 0.014, q: 2.5 }],
  },
  giggle: {
    notes: [n(0, 0.06, 990, 1240, "sine", 0.045), n(0.08, 0.06, 1100, 860, "sine", 0.045), n(0.16, 0.06, 1240, 990, "sine", 0.045)],
  },
  sad: { notes: [n(0, 0.18, 440, 330, "triangle", 0.05), n(0.2, 0.26, 330, 233, "triangle", 0.05)] },
  toggle: { notes: [n(0, 0.07, 620, 840, "sine", 0.05)] },
  switch: {
    notes: [n(0, 0.1, 440, 660, "triangle", 0.06), n(0.09, 0.14, 880, 1174, "triangle", 0.06)],
    noise: [{ at: 0, dur: 0.25, f0: 700, f1: 2600, gain: 0.028, q: 1.4 }],
  },
  addBusiness: {
    notes: [n(0, 0.09, 523, undefined, "triangle", 0.07), n(0.09, 0.09, 659, undefined, "triangle", 0.07), n(0.18, 0.16, 1046, undefined, "triangle", 0.08)],
    noise: [{ at: 0.18, dur: 0.25, f0: 2400, f1: 4800, gain: 0.02, q: 2.2 }],
  },
  removeBusiness: { notes: [n(0, 0.14, 520, 240, "triangle", 0.055)] },
};

/**
 * One melody per signature mood, in scale degrees around a fixed base
 * frequency. Rendered through each mascot's voice profile, so the same melody
 * is a sweet sparkle on Mithu and a raspy shout on Chotu.
 */
const MOOD_MELODIES: Record<SignatureMood, { notes: NoteSpec[] }> = {
  // C5-based: warm major lift
  happy: { notes: [n(0, 0.11, 523, undefined, "sine", 0.07), n(0.11, 0.11, 659, undefined, "sine", 0.07), n(0.22, 0.11, 784, undefined, "sine", 0.07), n(0.33, 0.2, 1046, undefined, "sine", 0.07)] },
  // low, punchy minor stabs
  angry: { notes: [n(0, 0.1, 220, 185, "square", 0.05), n(0.12, 0.1, 196, 165, "square", 0.05), n(0.24, 0.18, 165, 130, "square", 0.055)] },
  // four-on-the-floor groove with a swing step
  dance: { notes: [n(0, 0.09, 392, undefined, "sine", 0.06), n(0.1, 0.09, 523, undefined, "sine", 0.06), n(0.2, 0.09, 659, undefined, "sine", 0.06), n(0.3, 0.09, 523, undefined, "sine", 0.06), n(0.4, 0.09, 784, undefined, "sine", 0.065), n(0.5, 0.16, 659, undefined, "sine", 0.06)] },
  // soft bell glissando up (love-struck)
  hearts: { notes: [n(0, 0.14, 784, undefined, "sine", 0.055), n(0.12, 0.14, 988, undefined, "sine", 0.055), n(0.24, 0.2, 1175, undefined, "sine", 0.06)] },
  // rising questioning two-tone ("hm?")
  curious: { notes: [n(0, 0.14, 494, undefined, "sine", 0.06), n(0.16, 0.26, 622, 587, "sine", 0.065)] },
  // fast fanfire burst
  enthusiastic: { notes: [n(0, 0.08, 523, undefined, "sine", 0.065), n(0.08, 0.08, 659, undefined, "sine", 0.065), n(0.16, 0.08, 784, undefined, "sine", 0.065), n(0.24, 0.08, 1046, undefined, "sine", 0.07), n(0.32, 0.24, 1318, undefined, "sine", 0.06)] },
};

/** Singleton: one AudioContext for the whole app, created lazily on first gesture. */
export const soundKit = new SoundKit();
