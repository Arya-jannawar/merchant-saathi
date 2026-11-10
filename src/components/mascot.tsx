"use client";

/**
 * The Merchant Saathi mascot cast - six hand-drawn SVG characters.
 *
 * Every mood is a CSS class (ms-mascot--<mood>) driven by keyframes in
 * globals.css. Signature moods add per-mood particles (hearts, steam, stars,
 * notes, sparkles) tinted with the mascot's accent. The sound kit gives each
 * mascot a distinct voice for every mood (see src/lib/sound.ts).
 */

import { getMascot, type MascotId, type MascotMood } from "@/lib/mascots-config";

const MOOD_CLASS: Record<MascotMood, string> = {
  idle: "ms-mascot--idle",
  happy: "ms-mascot--happy",
  excited: "ms-mascot--excited",
  thinking: "ms-mascot--thinking",
  sad: "ms-mascot--sad",
  wave: "ms-mascot--wave",
  angry: "ms-mascot--angry",
  dance: "ms-mascot--dance",
  hearts: "ms-mascot--hearts",
  curious: "ms-mascot--curious",
  enthusiastic: "ms-mascot--enthusiastic",
};

/** Mouth geometry per mood, relative to a face centered at (cx, mouthY). */
function mouthPath(mood: MascotMood, cx: number, y: number): { d: string; filled: boolean } {
  switch (mood) {
    case "excited":
    case "enthusiastic":
      return { d: `M${cx - 12} ${y - 2} Q${cx} ${y + 20} ${cx + 12} ${y - 2} Z`, filled: true };
    case "happy":
    case "dance":
    case "hearts":
      return { d: `M${cx - 10} ${y} Q${cx} ${y + 12} ${cx + 10} ${y} Z`, filled: true };
    case "sad":
      return { d: `M${cx - 9} ${y + 6} Q${cx} ${y - 3} ${cx + 9} ${y + 6}`, filled: false };
    case "angry":
      return { d: `M${cx - 9} ${y + 4} L${cx - 3} ${y} L${cx + 3} ${y + 4} L${cx + 9} ${y}`, filled: false };
    case "curious":
      return { d: `M${cx} ${y} a4.5 4.5 0 1 0 0.01 0`, filled: false };
    case "thinking":
      return { d: `M${cx - 8} ${y + 2} Q${cx} ${y - 2} ${cx + 8} ${y + 2}`, filled: false };
    default:
      return { d: `M${cx - 9} ${y} Q${cx} ${y + 8} ${cx + 9} ${y}`, filled: false };
  }
}

function Face({
  cx,
  eyeY,
  eyeGap = 13,
  cheekY,
  mouthY,
  mood,
  eyeColor = "#0f172a",
}: {
  cx: number;
  eyeY: number;
  eyeGap?: number;
  cheekY: number;
  mouthY: number;
  mood: MascotMood;
  eyeColor?: string;
}) {
  const mouth = mouthPath(mood, cx, mouthY);
  const heartEyes = mood === "hearts";
  const squint = mood === "angry";
  return (
    <g className="ms-mascot__face">
      <g className="ms-mascot__eyes">
        <g className="ms-mascot__eye">
          {heartEyes ? (
            <path
              d={`M${cx - eyeGap} ${eyeY - 3} c-2-3.4 -7-2.2 -7 1.6 c0 2.6 3 4.6 7 7.6 c4-3 7-5 7-7.6 c0-3.8 -5-5 -7-1.6 Z`}
              fill="#f43f5e"
            />
          ) : (
            <>
              <circle cx={cx - eyeGap} cy={eyeY} r="5.5" fill={eyeColor} />
              <circle cx={cx - eyeGap - 1.8} cy={eyeY - 2} r="1.8" fill="#fff" />
            </>
          )}
        </g>
        <g className="ms-mascot__eye">
          {heartEyes ? (
            <path
              d={`M${cx + eyeGap} ${eyeY - 3} c-2-3.4 -7-2.2 -7 1.6 c0 2.6 3 4.6 7 7.6 c4-3 7-5 7-7.6 c0-3.8 -5-5 -7-1.6 Z`}
              fill="#f43f5e"
            />
          ) : (
            <>
              <circle cx={cx + eyeGap} cy={eyeY} r="5.5" fill={eyeColor} />
              <circle cx={cx + eyeGap - 1.8} cy={eyeY - 2} r="1.8" fill="#fff" />
            </>
          )}
        </g>
      </g>
      {squint ? (
        <g stroke="#7c2d12" strokeWidth="2.5" strokeLinecap="round" className="ms-mascot__brows">
          <path d={`M${cx - eyeGap - 7} ${eyeY - 9} L${cx - eyeGap + 6} ${eyeY - 6}`} />
          <path d={`M${cx + eyeGap + 7} ${eyeY - 9} L${cx + eyeGap - 6} ${eyeY - 6}`} />
        </g>
      ) : null}
      {mood === "curious" ? (
        <text x={cx + eyeGap + 12} y={eyeY - 12} fontSize="17" fontWeight="900" fill="#00b9f1" className="ms-mascot__qmark">
          ?
        </text>
      ) : null}
      <ellipse cx={cx - eyeGap - 8} cy={cheekY} rx="5" ry="3" fill="#fda4af" opacity={heartEyes ? 0.95 : 0.85} />
      <ellipse cx={cx + eyeGap + 8} cy={cheekY} rx="5" ry="3" fill="#fda4af" opacity={heartEyes ? 0.95 : 0.85} />
      <g className="ms-mascot__mouth">
        {mouth.filled ? (
          <path d={mouth.d} fill="#7c2d12" stroke="#7c2d12" strokeWidth="1.5" strokeLinejoin="round" />
        ) : (
          <path d={mouth.d} fill="none" stroke="#7c2d12" strokeWidth="2.5" strokeLinecap="round" />
        )}
      </g>
    </g>
  );
}

/** Mood-driven particle layer, tinted per mascot accent. */
function Particles({ accent }: { accent: string }) {
  return (
    <g>
      <g className="ms-p-hearts" fill="#f43f5e">
        <path d="M20 34 c-1.4-2.4 -5-1.6 -5 1.1 c0 1.9 2.2 3.3 5 5.4 c2.8-2.1 5-3.5 5-5.4 c0-2.7 -3.6-3.5 -5-1.1 Z" />
        <path d="M102 28 c-1.4-2.4 -5-1.6 -5 1.1 c0 1.9 2.2 3.3 5 5.4 c2.8-2.1 5-3.5 5-5.4 c0-2.7 -3.6-3.5 -5-1.1 Z" />
        <path d="M96 62 c-1-1.8 -3.8-1.2 -3.8 0.8 c0 1.4 1.6 2.5 3.8 4.1 c2.2-1.6 3.8-2.7 3.8-4.1 c0-2 -2.8-2.6 -3.8-0.8 Z" />
      </g>
      <g className="ms-p-stars" fill={accent}>
        <path d="M16 30 l2.4 5.4 5.4 2.4 -5.4 2.4 -2.4 5.4 -2.4 -5.4 -5.4 -2.4 5.4 -2.4 Z" />
        <path d="M104 22 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 Z" />
        <path d="M108 56 l1.7 3.8 3.8 1.7 -3.8 1.7 -1.7 3.8 -1.7 -3.8 -3.8 -1.7 3.8 -1.7 Z" />
      </g>
      <g className="ms-p-notes" stroke={accent} strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M18 40 q6-10 12-2" />
        <circle cx="16" cy="44" r="4" fill={accent} stroke="none" />
        <path d="M96 30 q6-10 12-2" />
        <circle cx="94" cy="34" r="4" fill={accent} stroke="none" />
      </g>
      <g className="ms-p-sparkles" fill={accent}>
        <path d="M14 26 l2.2 5 5 2.2 -5 2.2 -2.2 5 -2.2 -5 -5 -2.2 5 -2.2 Z" />
        <path d="M104 20 l1.8 4 4 1.8 -4 1.8 -1.8 4 -1.8 -4 -4 -1.8 4 -1.8 Z" />
      </g>
      <g className="ms-p-anger" stroke="#ef4444" strokeWidth="3.5" fill="none" strokeLinecap="round">
        <path d="M24 26 q4-7 -2-10" />
        <path d="M36 20 q4-7 -2-10" />
        <path d="M96 26 q-4-7 2-10" />
      </g>
      <g className="ms-p-steam" stroke="#94a3b8" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity="0.8">
        <path d="M50 22 q6-9 0-16" />
        <path d="M66 24 q-6-9 0-16" />
      </g>
    </g>
  );
}

function MithuBody({ mood }: { mood: MascotMood }) {
  return (
    <g className="ms-mascot__body">
      <g className="ms-mascot__cherry">
        <path d="M60 16 Q66 6 74 6" fill="none" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="60" cy="22" r="8" fill="#ef4444" />
        <circle cx="57" cy="19" r="2.4" fill="#fecaca" />
      </g>
      <path d="M24 66 Q20 44 44 40 Q48 24 64 28 Q82 22 90 40 Q102 48 96 64 Q90 76 60 76 Q32 76 24 66 Z" fill="#fff1e6" />
      <path d="M36 48 Q52 36 74 42" fill="none" stroke="#fce1d4" strokeWidth="5" strokeLinecap="round" />
      <path d="M28 62 q4 8 9 2" fill="none" stroke="#fff1e6" strokeWidth="6" strokeLinecap="round" />
      <path d="M78 64 q5 7 10 0" fill="none" stroke="#fff1e6" strokeWidth="6" strokeLinecap="round" />
      <Face cx={60} eyeY={57} cheekY={65} mouthY={73} mood={mood} />
      <ellipse className="ms-mascot__arm-left" cx="20" cy="72" rx="8" ry="4.5" fill="#fda4af" transform="rotate(-18 20 72)" />
      <g className="ms-mascot__arm-right">
        <ellipse cx="100" cy="72" rx="8" ry="4.5" fill="#fda4af" transform="rotate(18 100 72)" />
      </g>
      <path d="M26 78 L34 112 Q60 121 86 112 L94 78 Z" fill="#00b9f1" />
      <path d="M26 78 L94 78 L92.5 88 Q60 96 27.5 88 Z" fill="#33c7f4" />
      <path d="M40 80 L44 116" stroke="#0393c7" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 81 L60 119" stroke="#0393c7" strokeWidth="3" strokeLinecap="round" />
      <path d="M80 80 L76 116" stroke="#0393c7" strokeWidth="3" strokeLinecap="round" />
    </g>
  );
}

function ChotuBody({ mood }: { mood: MascotMood }) {
  return (
    <g className="ms-mascot__body">
      {/* samosa: plump triangle with a crimped ridge */}
      <path d="M60 18 Q84 34 98 74 Q104 96 92 104 Q60 116 28 104 Q16 96 22 74 Q36 34 60 18 Z" fill="#f4a950" />
      <path d="M60 18 Q70 28 76 44" fill="none" stroke="#d9822b" strokeWidth="5" strokeLinecap="round" />
      <path d="M60 18 Q52 30 46 46" fill="none" stroke="#d9822b" strokeWidth="5" strokeLinecap="round" />
      <path d="M44 30 Q38 44 36 56" fill="none" stroke="#e59240" strokeWidth="4" strokeLinecap="round" />
      <path d="M76 30 Q82 44 84 56" fill="none" stroke="#e59240" strokeWidth="4" strokeLinecap="round" />
      <Face cx={60} eyeY={62} cheekY={72} mouthY={80} mood={mood} />
      <ellipse className="ms-mascot__arm-left" cx="20" cy="84" rx="8" ry="4.5" fill="#ef8f3c" transform="rotate(-18 20 84)" />
      <g className="ms-mascot__arm-right">
        <ellipse cx="100" cy="84" rx="8" ry="4.5" fill="#ef8f3c" transform="rotate(18 100 84)" />
      </g>
      <path d="M38 108 Q60 118 82 108" stroke="#b45309" strokeWidth="4" fill="none" strokeLinecap="round" />
    </g>
  );
}

function DhoomBody({ mood }: { mood: MascotMood }) {
  return (
    <g className="ms-mascot__body">
      {/* cutting-glass of chai */}
      <path d="M38 46 L44 112 Q60 118 76 112 L82 46 Z" fill="#fef3c7" opacity="0.5" />
      <path d="M38 46 L44 112 Q60 118 76 112 L82 46 Z" fill="none" stroke="#e2e8f0" strokeWidth="4" />
      <path d="M41 62 L45.5 106 Q60 112 74.5 106 L79 62 Z" fill="#d9a05b" />
      <path d="M41 62 L79 62 L78 72 L42 72 Z" fill="#c1874a" />
      <path d="M46 78 q8 6 14 0 q7-6 14 0" fill="none" stroke="#b9823f" strokeWidth="3" strokeLinecap="round" />
      <Face cx={60} eyeY={78} eyeGap={11} cheekY={88} mouthY={94} mood={mood} />
      <ellipse className="ms-mascot__arm-left" cx="30" cy="92" rx="8" ry="4.5" fill="#e2e8f0" transform="rotate(-18 30 92)" />
      <g className="ms-mascot__arm-right">
        <ellipse cx="90" cy="92" rx="8" ry="4.5" fill="#e2e8f0" transform="rotate(18 90 92)" />
      </g>
      <path d="M40 46 Q42 30 36 22" fill="none" stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M60 44 Q62 28 56 18" fill="none" stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M80 46 Q78 30 84 22" fill="none" stroke="#cbd5e1" strokeWidth="3.5" strokeLinecap="round" />
    </g>
  );
}

function ShonaBody({ mood }: { mood: MascotMood }) {
  return (
    <g className="ms-mascot__body">
      {/* golden rupee coin */}
      <circle cx="60" cy="78" r="38" fill="#fbbf24" />
      <circle cx="60" cy="78" r="38" fill="none" stroke="#d97706" strokeWidth="5" />
      <circle cx="60" cy="78" r="29" fill="none" stroke="#fde68a" strokeWidth="2.5" />
      <text x="60" y="98" textAnchor="middle" fontSize="34" fontWeight="900" fill="#92400e">
        ₹
      </text>
      <Face cx={60} eyeY={62} cheekY={72} mouthY={80} mood={mood} />
      <ellipse className="ms-mascot__arm-left" cx="18" cy="86" rx="8" ry="4.5" fill="#d97706" transform="rotate(-18 18 86)" />
      <g className="ms-mascot__arm-right">
        <ellipse cx="102" cy="86" rx="8" ry="4.5" fill="#d97706" transform="rotate(18 102 86)" />
      </g>
      <path d="M60 16 q10 8 0 18 q-10 8 0 16" fill="none" stroke="#fcd34d" strokeWidth="4" strokeLinecap="round" />
    </g>
  );
}

function LadduBody({ mood }: { mood: MascotMood }) {
  return (
    <g className="ms-mascot__body">
      {/* motichoor laddu: orange sphere of tiny boondi */}
      <circle cx="60" cy="76" r="38" fill="#f59e0b" />
      <g fill="#fbbf24">
        <circle cx="42" cy="58" r="5" />
        <circle cx="58" cy="50" r="5" />
        <circle cx="74" cy="58" r="5" />
        <circle cx="36" cy="76" r="5" />
        <circle cx="86" cy="76" r="5" />
        <circle cx="46" cy="98" r="5" />
        <circle cx="74" cy="98" r="5" />
        <circle cx="60" cy="108" r="5" />
        <circle cx="60" cy="88" r="5" />
        <circle cx="30" cy="62" r="4" />
        <circle cx="90" cy="62" r="4" />
      </g>
      <path d="M60 30 q14-10 26-4 q-8 12 -26 8" fill="#16a34a" />
      <Face cx={60} eyeY={64} cheekY={74} mouthY={82} mood={mood} />
      <ellipse className="ms-mascot__arm-left" cx="18" cy="84" rx="8" ry="4.5" fill="#d97706" transform="rotate(-18 18 84)" />
      <g className="ms-mascot__arm-right">
        <ellipse cx="102" cy="84" rx="8" ry="4.5" fill="#d97706" transform="rotate(18 102 86)" />
      </g>
    </g>
  );
}

function JalebiBody({ mood }: { mood: MascotMood }) {
  return (
    <g className="ms-mascot__body">
      {/* jalebi: thick glossy spiral */}
      <g fill="none" stroke="#f97316" strokeWidth="13" strokeLinecap="round">
        <circle cx="60" cy="76" r="34" strokeDasharray="150 70" strokeDashoffset="-20" />
        <circle cx="60" cy="76" r="21" strokeDasharray="95 40" strokeDashoffset="10" />
        <circle cx="60" cy="76" r="8" strokeDasharray="38 14" />
      </g>
      <g fill="none" stroke="#fdba74" strokeWidth="4" strokeLinecap="round" opacity="0.9">
        <path d="M34 56 q10-14 26-16" />
        <path d="M84 92 q-8 12 -22 14" />
      </g>
      <Face cx={60} eyeY={64} eyeGap={12} cheekY={74} mouthY={82} mood={mood} />
      <ellipse className="ms-mascot__arm-left" cx="18" cy="88" rx="8" ry="4.5" fill="#ea580c" transform="rotate(-18 18 88)" />
      <g className="ms-mascot__arm-right">
        <ellipse cx="102" cy="88" rx="8" ry="4.5" fill="#ea580c" transform="rotate(18 102 88)" />
      </g>
    </g>
  );
}

const BODIES: Record<MascotId, (props: { mood: MascotMood }) => React.ReactNode> = {
  mithu: MithuBody,
  chotu: ChotuBody,
  dhoom: DhoomBody,
  shona: ShonaBody,
  laddu: LadduBody,
  jalebi: JalebiBody,
};

const ACCENTS: Record<MascotId, string> = {
  mithu: "#f472b6",
  chotu: "#ef4444",
  dhoom: "#0ea5e9",
  shona: "#fbbf24",
  laddu: "#f59e0b",
  jalebi: "#f97316",
};

export function MascotById({
  id = "mithu",
  mood = "idle",
  talking = false,
  size = 96,
  className = "",
}: {
  id?: MascotId;
  mood?: MascotMood;
  talking?: boolean;
  size?: number;
  className?: string;
}) {
  const Body = BODIES[id] ?? MithuBody;
  return (
    <svg
      viewBox="0 0 120 128"
      width={size}
      height={size * (128 / 120)}
      className={`ms-mascot ${MOOD_CLASS[mood]} ms-mascot--${id} ${talking ? "ms-mascot--talking" : ""} ${className}`}
      role="img"
      aria-label={`${getMascot(id).name}, the Merchant Saathi mascot`}
    >
      <Particles accent={ACCENTS[id] ?? "#f472b6"} />
      <Body mood={mood} />
    </svg>
  );
}

/** Back-compat alias: Mithu remains the default cast member. */
export const Mascot = MascotById;
