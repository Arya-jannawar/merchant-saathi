/**
 * The Merchant Saathi mascot cast. Six hand-drawn characters, each with four
 * signature moods (bold CSS animations) and a distinct voice profile so every
 * mascot × mood pair sounds different.
 */

export type MascotId = "mithu" | "chotu" | "dhoom" | "shona" | "laddu" | "jalebi";

export type SignatureMood = "happy" | "angry" | "dance" | "hearts" | "curious" | "enthusiastic";

export interface MascotDef {
  id: MascotId;
  name: string;
  tagline: string;
  /** Emoji shown for each signature mood in the picker. */
  signature: SignatureMood[];
  /** Voice profile used by the sound kit (see src/lib/sound.ts). */
  voice: {
    /** Semitone transposition of the mood jingle. */
    transpose: number;
    wave: OscillatorType;
    /** Tempo multiplier for the mood jingle (1 = base). */
    tempo: number;
    /** Unique closing flourish that identifies the mascot by ear. */
    flourish: "sparkle" | "pop" | "steam" | "coin" | "bounce" | "swirl";
  };
}

export const MOOD_EMOJI: Record<SignatureMood, string> = {
  happy: "😄",
  angry: "😡",
  dance: "💃",
  hearts: "💖",
  curious: "🤔",
  enthusiastic: "🤩",
};

export const MOOD_LABEL: Record<SignatureMood, string> = {
  happy: "Happy",
  angry: "Angry",
  dance: "Dance",
  hearts: "Hearts",
  curious: "Curious",
  enthusiastic: "Enthusiastic",
};

export const MASCOTS: MascotDef[] = [
  {
    id: "mithu",
    name: "Byte",
    tagline: "The cupcake - sweet, steady, always compiling",
    signature: ["happy", "dance", "hearts", "curious"],
    voice: { transpose: 0, wave: "sine", tempo: 1, flourish: "sparkle" },
  },
  {
    id: "chotu",
    name: "Firewall",
    tagline: "The samosa - spicy, loud, zero intrusions",
    signature: ["angry", "enthusiastic", "dance", "curious"],
    voice: { transpose: 4, wave: "square", tempo: 1.25, flourish: "pop" },
  },
  {
    id: "dhoom",
    name: "Java",
    tagline: "The chai - steaming hot, runs anywhere",
    signature: ["enthusiastic", "happy", "dance", "curious"],
    voice: { transpose: 7, wave: "triangle", tempo: 1.15, flourish: "steam" },
  },
  {
    id: "shona",
    name: "Crypto",
    tagline: "The coin - money-wise, decentralized energy",
    signature: ["dance", "happy", "enthusiastic", "hearts"],
    voice: { transpose: 12, wave: "sine", tempo: 0.9, flourish: "coin" },
  },
  {
    id: "laddu",
    name: "Pixel",
    tagline: "The laddu - round, jolly, refreshes first",
    signature: ["dance", "happy", "angry", "enthusiastic"],
    voice: { transpose: -3, wave: "triangle", tempo: 1.1, flourish: "bounce" },
  },
  {
    id: "jalebi",
    name: "Glitch",
    tagline: "The jalebi - twisty, syrupy, delightfully chaotic",
    signature: ["curious", "dance", "hearts", "angry"],
    voice: { transpose: 2, wave: "sawtooth", tempo: 0.95, flourish: "swirl" },
  },
];

export const DEFAULT_MASCOT: MascotId = "mithu";

export function getMascot(id: string | null | undefined): MascotDef {
  return MASCOTS.find((m) => m.id === id) ?? MASCOTS[0];
}

export type MascotMood =
  | "idle"
  | "happy"
  | "excited"
  | "thinking"
  | "sad"
  | "wave"
  | SignatureMood
  /** interaction emotions (hover / click / petting) */
  | "wink"
  | "surprised"
  | "giggle"
  /** idle sleep cycle */
  | "sleeping"
  | "wake";

/** Emotions the mascot can roll when you hover, click or pet it. */
export const INTERACTION_MOODS: MascotMood[] = ["wink", "giggle", "surprised", "curious"];
