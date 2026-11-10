"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mascot, type MascotMood } from "@/components/mascot";
import { soundKit, type SoundName } from "@/lib/sound";
import { api, type AssistantChatDto, type AssistantSettingsDto } from "@/lib/client";
import { BrainModal } from "@/components/saathi-brain-modal";
import { SaathiTour } from "@/components/saathi-tour";

/**
 * SaathiProvider mounts Mithu (mascot + speech bubble + chat) on every screen
 * and exposes a tiny API other components use to react to business events:
 *   const saathi = useSaathi();
 *   saathi.react("sad", "warn");            // mascot mood + sound effect
 *   saathi.say("Nice, offer approved!");    // speech bubble
 *   saathi.openChat("Why is ₹50 unsafe?");  // open the chat pre-filled
 *
 * The guided tour lives in saathi-tour.tsx and renders inside this provider.
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

  const setMoodTemporarily = useCallback((next: MascotMood, backTo: MascotMood = "idle", ms = 2_800) => {
    setMood(next);
    if (moodTimer.current) clearTimeout(moodTimer.current);
    moodTimer.current = setTimeout(() => setMood(backTo), ms);
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

  const sendMessage = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || thinking) return;
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
      }
    },
    [thinking, setMoodTemporarily]
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

      {/* mascot button */}
      <button
        type="button"
        onClick={() => (chatOpen ? (setChatOpen(false), soundKit.play("close")) : openChat())}
        onMouseEnter={() => {
          setHovered(true);
          if (!chatOpen) soundKit.play("hover");
        }}
        onMouseLeave={() => setHovered(false)}
        className={`fixed bottom-5 right-4 z-50 outline-none sm:right-6 ${hovered && !chatOpen ? "ms-wiggle" : ""}`}
        aria-label={chatOpen ? "Close chat with Mithu" : "Chat with Mithu, the Merchant Saathi mascot"}
        title="Hi! I'm Mithu - click me!"
      >
        <span className="ms-mascot-dock block">
          <Mascot mood={chatOpen ? "happy" : mood} talking={thinking} size={84} />
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
            <Mascot mood="happy" size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold leading-tight text-navy">Mithu</p>
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
              onClick={() => {
                setBrainOpen(true);
                soundKit.play("open");
              }}
              className="rounded-lg px-2 py-1 text-sm transition hover:bg-white/70"
              title="Give Mithu a live brain (API key)"
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
                  I&apos;m Mithu. Ask me anything about this demo - the decline, the offer math, approvals, the simulated
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
                  <p className="text-[11px] font-semibold text-slate-500">Checking the verified numbers…</p>
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
                placeholder="Ask Mithu…"
                aria-label="Ask Mithu a question"
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

      {tourOpen ? (
        <SaathiTour
          onClose={() => {
            setTourOpen(false);
            setMoodTemporarily("wave", "idle", 3_000);
          }}
        />
      ) : null}
    </SaathiContext.Provider>
  );
}
