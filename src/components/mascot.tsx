"use client";

/**
 * Mithu - the Merchant Saathi mascot.
 *
 * A hand-drawn SVG cupcake (the demo user is a bakery owner) with moods:
 * idle | happy | excited | thinking | sad | wave | talk.
 * All motion is CSS keyframes in globals.css (ms-* classes) so the character
 * stays in sync with the rest of the animation system and costs nothing at
 * runtime beyond compositing.
 */

export type MascotMood = "idle" | "happy" | "excited" | "thinking" | "sad" | "wave";

const MOOD_CLASS: Record<MascotMood, string> = {
  idle: "ms-mascot--idle",
  happy: "ms-mascot--happy",
  excited: "ms-mascot--excited",
  thinking: "ms-mascot--thinking",
  sad: "ms-mascot--sad",
  wave: "ms-mascot--wave",
};

function mouthPath(mood: MascotMood): string {
  switch (mood) {
    case "excited":
      return "M48 70 Q60 92 72 70 Z";
    case "happy":
      return "M50 72 Q60 84 70 72 Z";
    case "sad":
      return "M50 78 Q60 70 70 78";
    case "thinking":
      return "M60 74 a4.5 4.5 0 1 0 0.01 0";
    case "wave":
      return "M50 72 Q60 82 70 72";
    default:
      return "M50 72 Q60 80 70 72";
  }
}

function mouthIsFilled(mood: MascotMood): boolean {
  return mood === "excited" || mood === "happy";
}

export function Mascot({
  mood = "idle",
  talking = false,
  size = 96,
  className = "",
}: {
  mood?: MascotMood;
  talking?: boolean;
  size?: number;
  className?: string;
}) {
  const filled = mouthIsFilled(mood);
  return (
    <svg
      viewBox="0 0 120 128"
      width={size}
      height={size * (128 / 120)}
      className={`ms-mascot ${MOOD_CLASS[mood]} ${talking ? "ms-mascot--talking" : ""} ${className}`}
      role="img"
      aria-label="Mithu, the Merchant Saathi mascot"
    >
      {/* sparkles for the excited mood */}
      {mood === "excited" ? (
        <g className="ms-sparkles">
          <path d="M14 26 l2.2 5 5 2.2 -5 2.2 -2.2 5 -2.2 -5 -5 -2.2 5 -2.2 Z" fill="#fbbf24" />
          <path d="M104 20 l1.8 4 4 1.8 -4 1.8 -1.8 4 -1.8 -4 -4 -1.8 4 -1.8 Z" fill="#f472b6" />
          <path d="M110 52 l1.5 3.4 3.4 1.5 -3.4 1.5 -1.5 3.4 -1.5 -3.4 -3.4 -1.5 3.4 -1.5 Z" fill="#38bdf8" />
        </g>
      ) : null}

      <g className="ms-mascot__body">
        {/* cherry */}
        <g className="ms-mascot__cherry">
          <path d="M60 16 Q66 6 74 6" fill="none" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="60" cy="22" r="8" fill="#ef4444" />
          <circle cx="57" cy="19" r="2.4" fill="#fecaca" />
        </g>

        {/* frosting swirl */}
        <path
          d="M24 66 Q20 44 44 40 Q48 24 64 28 Q82 22 90 40 Q102 48 96 64 Q90 76 60 76 Q32 76 24 66 Z"
          fill="#fff1e6"
        />
        <path d="M36 48 Q52 36 74 42" fill="none" stroke="#fce1d4" strokeWidth="5" strokeLinecap="round" />
        {/* frosting drips */}
        <path d="M28 62 q4 8 9 2" fill="none" stroke="#fff1e6" strokeWidth="6" strokeLinecap="round" />
        <path d="M78 64 q5 7 10 0" fill="none" stroke="#fff1e6" strokeWidth="6" strokeLinecap="round" />

        {/* face */}
        <g className="ms-mascot__face">
          <g className="ms-mascot__eyes">
            <g className="ms-mascot__eye">
              <circle cx="47" cy="57" r="5.5" fill="#0f172a" />
              <circle cx="45.2" cy="55" r="1.8" fill="#fff" />
            </g>
            <g className="ms-mascot__eye">
              <circle cx="73" cy="57" r="5.5" fill="#0f172a" />
              <circle cx="71.2" cy="55" r="1.8" fill="#fff" />
            </g>
          </g>
          <ellipse cx="38" cy="65" rx="5" ry="3" fill="#fda4af" opacity="0.85" />
          <ellipse cx="82" cy="65" rx="5" ry="3" fill="#fda4af" opacity="0.85" />
          <g className="ms-mascot__mouth">
            {filled ? (
              <path d={mouthPath(mood)} fill="#7c2d12" stroke="#7c2d12" strokeWidth="1.5" strokeLinejoin="round" />
            ) : (
              <path d={mouthPath(mood)} fill="none" stroke="#7c2d12" strokeWidth="2.5" strokeLinecap="round" />
            )}
            {mood === "excited" ? <path d="M56 79 q4 4 8 0" fill="#f472b6" /> : null}
          </g>
        </g>

        {/* arms */}
        <ellipse className="ms-mascot__arm-left" cx="20" cy="72" rx="8" ry="4.5" fill="#fda4af" transform="rotate(-18 20 72)" />
        <g className="ms-mascot__arm-right">
          <ellipse cx="100" cy="72" rx="8" ry="4.5" fill="#fda4af" transform="rotate(18 100 72)" />
        </g>

        {/* cup */}
        <path d="M26 78 L34 112 Q60 121 86 112 L94 78 Z" fill="#00b9f1" />
        <path d="M26 78 L94 78 L92.5 88 Q60 96 27.5 88 Z" fill="#33c7f4" />
        <path d="M40 80 L44 116" stroke="#0393c7" strokeWidth="3" strokeLinecap="round" />
        <path d="M60 81 L60 119" stroke="#0393c7" strokeWidth="3" strokeLinecap="round" />
        <path d="M80 80 L76 116" stroke="#0393c7" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
