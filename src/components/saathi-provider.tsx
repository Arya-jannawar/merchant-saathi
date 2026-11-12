"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MascotById } from "@/components/mascot";
import { getMascot, INTERACTION_MOODS, MASCOTS, type MascotId, type MascotMood, type SignatureMood } from "@/lib/mascots-config";
import { soundKit, type SoundName } from "@/lib/sound";
import { api, ApiClientError, getActiveMerchantId, setActiveMerchantId, type AssistantChatDto, type AssistantSettingsDto, type DemoStateDto, type MerchantDto } from "@/lib/client";
import { BrainModal } from "@/components/saathi-brain-modal";
import { RegisterBusinessModal } from "@/components/register-business";
import { SaathiTour } from "@/components/saathi-tour";
import { MascotPicker } from "@/components/mascot-picker";

/**
 * SaathiProvider mounts the mascot cast (mascot + speech bubble + chat) on
 * every screen and exposes a tiny API other components use to react to
 * business events:
 *   const saathi = useSaathi();
 *   saathi.react("sad", "warn");            // mascot mood + sound effect
 *   saathi.say("Nice, offer approved!");    // speech bubble
 *   saathi.openChat("Why is ₹50 unsafe?");  // open the chat pre-filled
 *
 * The guided tour lives in saathi-tour.tsx and renders inside this provider.
 * The mascot choice and the active business are persisted per browser.
 */

export interface SaathiApi {
  say: (text: string, opts?: { mood?: MascotMood; durationMs?: number; sound?: SoundName }) => void;
  react: (mood: MascotMood, sound?: SoundName) => void;
  openChat: (prefill?: string) => void;
  startTour: () => void;
  play: (name: SoundName) => void;
}

const SaathiContext = createContext<SaathiApi | null>(null);

export function useSaathi(): SaathiApi {
  const ctx = useContext(SaathiContext);
  if (!ctx) throw new Error("useSaathi must be used inside <SaathiProvider>.");
  return ctx;
}

interface BubbleState {
  text: string;
  id: number;
}

interface ChatMessage {
  id: number;
  role: "user" | "mithu";
  text: string;
  mode?: AssistantChatDto["mode"];
  note?: string | null;
  reasoning?: string[];
  followUps?: string[];
}

const IDLE_TIPS = [
  "Ask me anything about the numbers - I only answer from verified facts.",
  "Try an unsafe price in the offer workspace. I will react, trust me.",
  "Everything labeled 'simulated' is simulated - I never blur that line.",
  "Want the grand tour? Click 'Show me around' in the chat.",
];

let nextId = 1;

export function SaathiProvider({ children }: { children: ReactNode }) {
  const [mood, setMood] = useState<MascotMood>("idle");
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [brainOpen, setBrainOpen] = useState(false);
  const [brainStatus, setBrainStatus] = useState<AssistantSettingsDto | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [soundOn, setSoundOn] = useState(soundKit.enabled);
  const [hovered, setHovered] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [mascotId, setMascotId] = useState<MascotId>(() => {
    if (typeof window === "undefined") return "mithu";
    return getMascot(window.localStorage.getItem("ms_mascot")).id;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const lastActiveRef = useRef<number>(Date.now());
  const sleepingRef = useRef(false);
  const hoverTimesRef = useRef<number[]>([]);
  const hoverCooldownRef = useRef(0);
  const petCooldownRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickCountRef = useRef(0);
  const showcaseRef = useRef(false);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipIndex = useRef(0);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => soundKit.subscribe(setSoundOn), []);

  // Cycle quiet tips when idle (paused while the chat is open).
  useEffect(() => {
    if (chatOpen || bubble || brainOpen) return;
    const t = setTimeout(() => {
      setBubble({ text: IDLE_TIPS[tipIndex.current % IDLE_TIPS.length], id: nextId++ });
      tipIndex.current += 1;
    }, 14_000);
    return () => clearTimeout(t);
  }, [chatOpen, bubble, brainOpen]);

  useEffect(() => {
    if (!bubble) return;
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 7_000);
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    };
  }, [bubble]);

  useEffect(() => {
    chatBodyRef.current?.scrollTo({ top: chatBodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const play = useCallback((name: SoundName) => soundKit.play(name), []);

  const setMoodTemporarily = useCallback((next: MascotMood, backTo: MascotMood = "idle", ms?: number) => {
    const duration = ms ?? (next === "dance" || next === "hearts" || next === "curious" || next === "enthusiastic" || next === "angry" ? 3_400 : 2_800);
    setMood(next);
    if (moodTimer.current) clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setMood(backTo), duration);
  }, []);

  const say = useCallback(
    (text: string, opts?: { mood?: MascotMood; durationMs?: number; sound?: SoundName }) => {
      setBubble({ text, id: nextId++ });
      if (opts?.mood) setMoodTemporarily(opts.mood);
      if (opts?.sound) soundKit.play(opts.sound);
    },
    [setMoodTemporarily]
  );

  const react = useCallback(
    (next: MascotMood, sound?: SoundName) => {
      setMoodTemporarily(next);
      if (sound) soundKit.play(sound);
    },
    [setMoodTemporarily]
  );

  const openChat = useCallback((prefill?: string) => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble(null);
    setChatOpen(true);
    soundKit.play("open");
    if (prefill) setInput(prefill);
  }, []);

  const startTour = useCallback(() => {
    setChatOpen(false);
    setBubble(null);
    setTourOpen(true);
    soundKit.play("jingle");
  }, []);

  const loadBrainStatus = useCallback(async () => {
    try {
      setBrainStatus(await api<AssistantSettingsDto>("/api/assistant/settings"));
    } catch {
      setBrainStatus({ configured: false, maskedKey: null, model: null, baseUrl: null, setAtIso: null });
    }
  }, []);

  useEffect(() => {
    void loadBrainStatus();
  }, [loadBrainStatus]);

  // ---- mascot life signs ------------------------------------------------
  // Sleep after 45s without any input; wake (stretch + sound) on the next one.
  // While awake and idle-ish, roll a small random emotion every ~20s so the
  // buddy never sits still.
  const wakeUp = useCallback(() => {
    if (!sleepingRef.current) return;
    sleepingRef.current = false;
    setMoodTemporarily("wake", "idle", 1_400);
    soundKit.play("wake");
  }, [setMoodTemporarily]);

  useEffect(() => {
    const activity = (): void => {
      lastActiveRef.current = Date.now();
      if (sleepingRef.current) wakeUp();
    };
    const events: (keyof WindowEventMap)[] = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));

    const tick = setInterval(() => {
      if (sleepingRef.current) return;
      if (Date.now() - lastActiveRef.current > 45_000) {
        sleepingRef.current = true;
        setMood("sleeping");
        soundKit.play("sleep");
        return;
      }
      // ambient charm: a tiny emotion between long stretches of quiet
      if (Date.now() - lastActiveRef.current > 12_000 && !chatOpen && !tourOpen && !pickerOpen && mood === "idle") {
        const roll = INTERACTION_MOODS[Math.floor(Math.random() * INTERACTION_MOODS.length)];
        setMoodTemporarily(roll, "idle", 1_500);
      }
    }, 2_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, activity));
      clearInterval(tick);
    };
  }, [chatOpen, tourOpen, pickerOpen, mood, setMoodTemporarily, wakeUp]);

  const sendingRef = useRef(false);
  const sendMessage = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || sendingRef.current) return;
      sendingRef.current = true;
      setInput("");
      setMessages((m) => [...m, { id: nextId++, role: "user", text: question }]);
      setThinking(true);
      soundKit.play("send");
      setMoodTemporarily("thinking", "idle", 20_000);
      try {
        const res = await api<AssistantChatDto>("/api/assistant/chat", {
          method: "POST",
          body: JSON.stringify({ question }),
        });
        setMessages((m) => [
          ...m,
          {
            id: nextId++,
            role: "mithu",
            text: res.answer,
            mode: res.mode,
            note: res.note,
            reasoning: res.reasoning,
            followUps: res.followUps,
          },
        ]);
        setMoodTemporarily("happy");
        soundKit.play("reply");
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            id: nextId++,
            role: "mithu",
            text:
              err instanceof Error
                ? `I could not reach my brain: ${err.message}. The demo server may be restarting - try again in a moment.`
                : "I could not reach my brain just now - try again in a moment.",
          },
        ]);
        setMoodTemporarily("sad");
        soundKit.play("error");
      } finally {
        setThinking(false);
        sendingRef.current = false;
      }
    },
    [setMoodTemporarily]
  );

  // The API surface is intentionally mood-free and built from stable callbacks:
  // pages can put `useSaathi()` results in effect dependencies without the
  // mascot's moods re-triggering their loads.
  const apiValue = useMemo<SaathiApi>(
    () => ({ say, react, openChat, startTour, play }),
    [say, react, openChat, startTour, play]
  );

  return (
    <SaathiContext.Provider value={apiValue}>
      {children}

      {/* active business strip */}
      <MerchantStrip
        onSwitched={(m, prevName) => {
          soundKit.play("switch");
          say(`Now viewing ${m.name}${prevName ? ` (was ${prevName})` : ""} - every number on screen is ${m.name}'s.`, {
            mood: "curious",
          });
        }}
        onAdded={(m) => {
          soundKit.play("addBusiness");
          say(`${m.name} joined the shelf! Their numbers are seeded and ready - take a look around.`, {
            mood: "enthusiastic",
          });
        }}
        onRemoved={(name) => {
          soundKit.play("removeBusiness");
          say(`${name} is gone - their rows were deleted for good.`, { mood: "sad" });
        }}
      />

      {/* floating sound toggle */}
      <button
        type="button"
        onClick={() => {
          soundKit.setEnabled(!soundKit.enabled);
          setSoundOn(soundKit.enabled);
        }}
        className={`ms-pop fixed bottom-5 left-5 z-40 flex h-10 w-10 items-center justify-center rounded-full border text-lg shadow-card transition hover:scale-110 ${
          soundOn ? "border-brand bg-white text-brand" : "border-slate-200 bg-slate-100 text-slate-400"
        }`}
        aria-label={soundOn ? "Mute sounds" : "Unmute sounds"}
        title={soundOn ? "Mute sounds" : "Unmute sounds"}
      >
        {soundOn ? "🔊" : "🔇"}
      </button>

      {/* speech bubble */}
      {bubble && !chatOpen ? (
        <div
          key={bubble.id}
          className="ms-pop fixed bottom-[168px] right-4 z-40 w-64 rounded-2xl rounded-br-sm border-2 border-navy/15 bg-white px-4 py-3 text-sm font-semibold text-navy shadow-card sm:right-6"
          role="status"
        >
          {bubble.text}
        </div>
      ) : null}

      {/* mascot picker chip */}
      <button
        type="button"
        onClick={() => {
          setPickerOpen(true);
          soundKit.play("open");
        }}
        className="ms-pop fixed bottom-[130px] right-6 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-brand bg-white text-sm shadow-card transition hover:scale-110 sm:right-7"
        aria-label="Choose your mascot buddy"
        title="Pick your buddy"
      >
        🎭
      </button>

      {/* mascot button */}
      <button
        type="button"
        onClick={() => {
          if (sleepingRef.current) {
            wakeUp();
            return;
          }
          if (chatOpen) {
            setChatOpen(false);
            soundKit.play("close");
            return;
          }
          clickCountRef.current += 1;
          if (clickCountRef.current === 1) {
            clickTimerRef.current = setTimeout(() => {
              clickCountRef.current = 0;
              if (!showcaseRef.current) openChat();
            }, 280);
          } else {
            if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
            clickCountRef.current = 0;
            // double-click: a mini showcase of this buddy's signature moves
            showcaseRef.current = true;
            say(`${getMascot(mascotId).name}'s signature moves - hover the mood chips in the 🎭 picker to hear them all!`, { mood: "excited" });
            let i = 0;
            const buddy = MASCOTS.find((m) => m.id === mascotId)!;
            const step = setInterval(() => {
              if (i >= buddy.signature.length) {
                clearInterval(step);
                showcaseRef.current = false;
                setMood("idle");
                soundKit.play("giggle");
                return;
              }
              const m = buddy.signature[i];
              setMoodTemporarily(m, "idle", 1_250);
              soundKit.playMascot(mascotId, m);
              i += 1;
            }, 1_300);
          }
        }}
        onMouseEnter={() => {
          setHovered(true);
          if (sleepingRef.current) return; // let them dream
          if (!chatOpen) soundKit.play("hover");
          // a fresh emotion on every visit, with a small cooldown so it never flickers
          const now = Date.now();
          if (now > hoverCooldownRef.current) {
            hoverCooldownRef.current = now + 1_400;
            const roll = INTERACTION_MOODS[Math.floor(Math.random() * INTERACTION_MOODS.length)] as MascotMood;
            setMoodTemporarily(roll, "idle", 1_300);
            soundKit.playEmotion(mascotId, roll as string);
          }
        }}
        onMouseMove={() => {
          // petting: brush over the buddy a few times and it melts
          if (sleepingRef.current) return;
          const now = Date.now();
          hoverTimesRef.current = [...hoverTimesRef.current.filter((t) => now - t < 2_600), now];
          if (hoverTimesRef.current.length >= 5 && now > petCooldownRef.current) {
            hoverTimesRef.current = [];
            petCooldownRef.current = now + 15_000;
            setMoodTemporarily("hearts", "idle", 2_800);
            soundKit.playMascot(mascotId, "hearts");
            say("So much attention! My turnaround time just got faster. 💖", { mood: "hearts" });
          }
        }}
        onMouseLeave={() => setHovered(false)}
        className={`fixed bottom-5 right-4 z-50 outline-none sm:right-6 ${hovered && !chatOpen ? "ms-wiggle" : ""}`}
        aria-label={chatOpen ? `Close chat with ${getMascot(mascotId).name}` : `Chat with ${getMascot(mascotId).name}, your Merchant Saathi buddy`}
        title="Hi! Click me - double-click for my signature moves!"
      >
        <span className="ms-mascot-dock block">
          <MascotById id={mascotId} mood={chatOpen ? "happy" : mood} talking={thinking} size={84} />
        </span>
        {!chatOpen ? (
          <span className="ms-pulse absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-rose-500 text-xs font-black text-white">
            1
          </span>
        ) : null}
      </button>

      {/* chat drawer */}
      {chatOpen ? (
        <div className="ms-slide-up fixed bottom-[150px] right-4 z-50 flex h-[min(560px,68vh)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card sm:right-6">
          <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-light to-accent-soft px-4 py-3">
            <MascotById id={mascotId} mood="happy" size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold leading-tight text-navy">{getMascot(mascotId).name}</p>
              <p className="text-[11px] font-semibold text-slate-500">
                {brainStatus?.configured ? `Live brain · ${brainStatus.model}` : "Fact-book brain · verified numbers only"}
              </p>
            </div>
            <button
              type="button"
              onClick={startTour}
              className="rounded-lg px-2 py-1 text-sm transition hover:bg-white/70"
              title="Show me around (guided tour)"
              aria-label="Show me around (guided tour)"
            >
              🗺
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="rounded-lg px-2 py-1 text-sm transition hover:bg-white/70"
              title="Pick your buddy (mascot)"
              aria-label="Choose your mascot"
            >
              🎭
            </button>
            <button
              type="button"
              onClick={() => {
                setBrainOpen(true);
                soundKit.play("open");
              }}
              className="rounded-lg px-2 py-1 text-sm transition hover:bg-white/70"
              title="Give the mascot a live brain (API key)"
              aria-label="Assistant brain settings"
            >
              🧠
            </button>
            <button
              type="button"
              onClick={() => {
                setChatOpen(false);
                soundKit.play("close");
              }}
              className="rounded-lg px-2 py-1 text-sm font-bold text-slate-500 transition hover:bg-white/70"
              aria-label="Close chat"
            >
              ✕
            </button>
          </div>

          <div ref={chatBodyRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 ? (
              <div className="rounded-2xl bg-brand-light p-3 text-sm leading-relaxed text-navy">
                <p className="font-bold">Namaste! 🧁</p>
                <p className="mt-1">
                  I&apos;m {getMascot(mascotId).name}. Ask me anything about this demo - the decline, the offer math, approvals, the simulated
                  campaign - and I&apos;ll answer from the verified numbers only.
                </p>
                <button
                  type="button"
                  onClick={startTour}
                  className="mt-2 rounded-xl border border-brand/40 bg-white px-3 py-1.5 text-xs font-bold text-brand transition hover:bg-white/70"
                >
                  🗺 Show me around
                </button>
              </div>
            ) : null}
            {messages.map((m) => (
              <div key={m.id} className={`ms-pop flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === "user" ? "rounded-br-sm bg-navy text-white" : "rounded-bl-sm border border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {m.role === "mithu" && m.mode ? (
                    <span className="mb-1 inline-block">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          m.mode === "live"
                            ? "bg-emerald-50 text-emerald-700"
                            : m.mode === "fallback"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {m.mode === "live" ? "live brain" : m.mode === "fallback" ? "fallback" : "fact book"}
                      </span>
                    </span>
                  ) : null}
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.reasoning?.length ? (
                    <details className="mt-2 rounded-xl bg-white/70 p-2 text-xs">
                      <summary className="cursor-pointer font-bold text-brand">🧠 How I reasoned</summary>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-slate-600">
                        {m.reasoning.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  {m.note ? <p className="mt-1.5 text-[11px] italic text-slate-400">{m.note}</p> : null}
                  {m.followUps?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.followUps.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => void sendMessage(f)}
                          className="rounded-full border border-brand/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand-light"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {thinking ? (
              <div className="ms-pop flex justify-start">
                <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                  <p className="text-[11px] font-semibold text-slate-500">{getMascot(mascotId).name} is checking the verified numbers…</p>
                  <div className="mt-1 flex gap-1">
                    <span className="ms-dot ms-dot-1 h-2 w-2 rounded-full bg-accent" />
                    <span className="ms-dot ms-dot-2 h-2 w-2 rounded-full bg-accent" />
                    <span className="ms-dot ms-dot-3 h-2 w-2 rounded-full bg-accent" />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-100 px-3 py-2">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {["Why are orders down?", "Is ₹70 safe?", "What does approving do?", "What did the campaign earn?"].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendMessage(q)}
                  disabled={thinking}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-brand hover:text-brand disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage(input);
              }}
              className="flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask ${getMascot(mascotId).name}…`}
                aria-label={`Ask ${getMascot(mascotId).name} a question`}
                maxLength={500}
                className="flex-1 !py-2"
              />
              <button type="submit" disabled={thinking || input.trim().length < 2} className="btn-primary !px-3 !py-2">
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <BrainModal
        open={brainOpen}
        status={brainStatus}
        onClose={() => {
          setBrainOpen(false);
          soundKit.play("close");
        }}
        onSaved={(s) => {
          setBrainStatus(s);
          say("Ooh, a live brain! Ask me anything - I'll still only use the verified numbers. 🧠", { mood: "excited", sound: "jingle" });
        }}
      />

      <MascotPicker
        open={pickerOpen}
        selectedId={mascotId}
        onClose={() => {
          setPickerOpen(false);
          soundKit.play("close");
        }}
        onPick={(id) => {
          setMascotId(id);
          if (typeof window !== "undefined") window.localStorage.setItem("ms_mascot", id);
          say(`${getMascot(id).name} is your buddy now! Hover the mood chips to hear their tunes.`, { mood: "excited" });
        }}
      />

      {tourOpen ? (
        <SaathiTour
          mascotId={mascotId}
          onClose={() => {
            setTourOpen(false);
            setMoodTemporarily("wave", "idle", 3_000);
          }}
        />
      ) : null}
    </SaathiContext.Provider>
  );
}

/**
 * Active-business strip: switch between the session's businesses, add a new
 * one, or remove one. Switching persists the id (client module var + header)
 * and reloads so every screen refetches with the new scope.
 */
function MerchantStrip({
  onSwitched,
  onAdded,
  onRemoved,
}: {
  onSwitched: (m: MerchantDto, prevName: string | null) => void;
  onAdded: (m: MerchantDto) => void;
  onRemoved: (name: string) => void;
}) {
  const [merchants, setMerchants] = useState<MerchantDto[]>([]);
  const [active, setActive] = useState<string | null>(getActiveMerchantId());
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = merchants.find((m) => m.id === active) ?? null;

  useEffect(() => {
    let cancelled = false;
    api<{ merchants: MerchantDto[] }>("/api/merchants")
      .then((res) => {
        if (cancelled) return;
        setMerchants(res.merchants);
        const stored = getActiveMerchantId();
        const valid = res.merchants.some((m) => m.id === stored);
        if (!valid) {
          setActiveMerchantId(res.merchants[0]?.id ?? null);
          setActive(res.merchants[0]?.id ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (merchants.length === 0) return null;

  async function switchTo(m: MerchantDto) {
    if (m.id === active) {
      setOpen(false);
      return;
    }
    const prevName = current?.name ?? null;
    setActiveMerchantId(m.id);
    setActive(m.id);
    setOpen(false);
    onSwitched(m, prevName);
    // Reload so every screen refetches with the new merchant scope.
    setTimeout(() => window.location.reload(), 550);
  }

  async function remove(m: MerchantDto) {
    if (!window.confirm(`Remove ${m.name}? All of its demo rows are deleted for good.`)) return;
    setBusy(true);
    try {
      await api(`/api/merchants/${m.id}`, { method: "DELETE" });
      const rest = merchants.filter((x) => x.id !== m.id);
      setMerchants(rest);
      onRemoved(m.name);
      if (m.id === active) {
        setActiveMerchantId(rest[0]?.id ?? null);
        setActive(rest[0]?.id ?? null);
        setTimeout(() => window.location.reload(), 550);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-[104px] left-4 z-40" data-tour="merchant-strip">
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            soundKit.play(open ? "close" : "open");
          }}
          className="ms-pop flex max-w-[260px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-navy shadow-card transition hover:border-brand"
          aria-expanded={open}
          aria-label="Switch business"
        >
          <span aria-hidden>🏪</span>
          <span className="truncate">{current ? current.name : "Businesses"}</span>
          <span aria-hidden className="text-slate-400">{open ? "▴" : "▾"}</span>
        </button>
        {open ? (
          <div className="ms-pop absolute left-0 top-9 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-card">
            <ul className="space-y-0.5">
              {merchants.map((m) => (
                <li key={m.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void switchTo(m)}
                    disabled={busy}
                    className={`flex-1 truncate rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                      m.id === active ? "bg-accent-soft text-brand" : "text-slate-600 hover:bg-brand-light hover:text-brand"
                    }`}
                  >
                    <span aria-hidden className="mr-1">{m.domain.emoji}</span>
                    {m.name}
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">{m.domain.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(m)}
                    disabled={busy}
                    className="rounded-lg px-1.5 py-1 text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Remove ${m.name}`}
                    title={`Remove ${m.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setWizardOpen(true);
                soundKit.play("open");
              }}
              disabled={busy}
              className="mt-1 w-full rounded-xl border border-dashed border-brand/40 px-3 py-2 text-xs font-bold text-brand transition hover:bg-brand-light"
            >
              + Register a business
            </button>
            <p className="mt-1.5 px-1 text-[10px] leading-snug text-slate-400">
              Each business gets its own seeded numbers, offer and campaigns. Data stays in this browser session.
            </p>
          </div>
        ) : null}
      </div>
      <RegisterBusinessModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onRegistered={(m) => {
          setMerchants((list) => [...list, m]);
          setActiveMerchantId(m.id);
          setActive(m.id);
          onAdded(m);
        }}
      />
    </div>
  );
}
