"use client";

import { useEffect, useRef, useState } from "react";
import { MascotById } from "@/components/mascot";
import { MASCOTS, MOOD_EMOJI, MOOD_LABEL, getMascot, type MascotId, type SignatureMood } from "@/lib/mascots-config";
import { soundKit } from "@/lib/sound";

/**
 * "Pick your buddy" dialog: the whole cast, each card cycling its four
 * signature moods. Hovering a mood button previews that animation with the
 * mascot's unique voice for it; picking one sets it everywhere (localStorage).
 */
export function MascotPicker({
  open,
  selectedId,
  onClose,
  onPick,
}: {
  open: boolean;
  selectedId: MascotId;
  onClose: () => void;
  onPick: (id: MascotId) => void;
}) {
  const [preview, setPreview] = useState<{ id: MascotId; mood: SignatureMood } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!open) setPreview(null);
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
    };
  }, [open]);

  if (!open) return null;

  function previewMood(id: MascotId, mood: SignatureMood) {
    setPreview({ id, mood });
    soundKit.playMascot(id, mood);
    const key = `${id}:${mood}`;
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => setPreview((p) => (p && p.id === id && p.mood === mood ? null : p)), 1900);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-deep/50 p-4" role="dialog" aria-modal="true" aria-label="Choose your mascot">
      <div className="ms-pop flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-navy">Pick your buddy 🎭</h2>
            <p className="text-xs text-slate-500">Six saathis, four signature moves each - every move has its own tune.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 font-bold text-slate-500 transition hover:bg-slate-100" aria-label="Close mascot picker">
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-3 overflow-y-auto pb-1 sm:grid-cols-2">
          {MASCOTS.map((m) => {
            const selected = m.id === selectedId;
            const moodToShow = preview?.id === m.id ? preview.mood : undefined;
            return (
              <div
                key={m.id}
                className={`relative rounded-2xl border-2 p-3 transition ${selected ? "border-accent bg-accent-soft" : "border-slate-200 hover:border-brand/40"}`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onPick(m.id);
                      soundKit.playMascot(m.id, m.signature[0]);
                      onClose();
                    }}
                    className="shrink-0 rounded-xl p-1 transition hover:scale-105"
                    aria-label={`Choose ${m.name} as your mascot`}
                    title={`Choose ${m.name}`}
                  >
                    <MascotById id={m.id} mood={moodToShow ?? (selected ? "happy" : "idle")} size={72} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-extrabold text-navy">
                      {m.name}
                      {selected ? <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">yours</span> : null}
                    </p>
                    <p className="text-[11px] leading-snug text-slate-500">{m.tagline}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {m.signature.map((mood) => (
                        <button
                          key={mood}
                          type="button"
                          onMouseEnter={() => previewMood(m.id, mood)}
                          onFocus={() => previewMood(m.id, mood)}
                          onClick={() => previewMood(m.id, mood)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold transition ${
                            preview?.id === m.id && preview?.mood === mood
                              ? "border-accent bg-white text-accent"
                              : "border-slate-200 bg-white text-slate-500 hover:border-brand hover:text-brand"
                          }`}
                          aria-label={`Preview ${m.name} being ${MOOD_LABEL[mood]}`}
                        >
                          {MOOD_EMOJI[mood]} {MOOD_LABEL[mood]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-center text-[11px] text-slate-400">
          Hover or tap a mood chip to hear each buddy&apos;s own tune - {getMascot(selectedId).name} will use the same voice
          in your chats.
        </p>
      </div>
    </div>
  );
}
