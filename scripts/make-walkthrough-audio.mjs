/**
 * Generates the female-voice narration for the Merchant Saathi walkthrough,
 * one MP3 per scene, and prints each file's duration.
 *
 * Tooling (not committed to package.json):  npm install --no-save msedge-tts ffmpeg-static
 * Voice: en-IN-NeerjaNeural (female, Indian English).
 *
 * Usage: node scripts/make-walkthrough-audio.mjs
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const OUT_DIR = path.resolve(process.cwd(), "docs", "media", "voiceover");

const SCENES = [
  {
    id: "01-dashboard",
    text:
      "Welcome to Merchant Saathi — an AI business partner for small shops, built by Team FinovateX for the Paytm AI Hackathon. " +
      "Every number here is synthetic and clearly labeled. This is Anaya's Bakery. " +
      "Completed afternoon orders fell from one hundred to seventy — down thirty percent — while average order value stayed flat at eighty rupees. " +
      "Fewer customers, not smaller bills.",
  },
  {
    id: "02-evidence",
    text:
      "The Opportunity page explains the decline in plain language. Charts are drawn from the order records — never hand made. " +
      "Open the evidence drawer: every number shows its metric ID, its definition, the time window it covers, and its source. " +
      "The page also says what the evidence does not prove — like the reason for the decline — so the product never over claims.",
  },
  {
    id: "03-offer-math",
    text:
      "In the Offer workspace, the owner designs a bundle: two samosas and one tea. Code computes everything: " +
      "thirty rupees contribution, a forty two point nine percent margin against the twenty five percent floor, capacity of twenty five bundles, " +
      "and a maximum discount exposure of four hundred rupees. " +
      "Try an unsafe price of fifty rupees — the margin drops to twenty percent, the check fails in red, and approval is blocked. " +
      "Back to seventy rupees, and the offer passes again.",
  },
  {
    id: "04-ai-draft",
    text:
      "The AI draft is bounded. Fixture mode is clearly labeled — no model call is hidden. " +
      "The assistant explains verified facts only, and code computes every suggested correction — the AI may only repeat them, never invent them. " +
      "Switch the customer message to Hindi for local shoppers; it is marked as a draft translation for review. " +
      "An action plan lists safe next steps, grounded in the same computed numbers.",
  },
  {
    id: "05-approve-queue",
    text:
      "Approval binds the exact version: the price, the cap, the validity window, an audience of forty consented demo customers, and a preview hash. " +
      "Any later change to terms, stock, or consent invalidates the approval. " +
      "One click queues the simulated campaign — forty recipients enter a simulated outbox. The button never says send, because nothing is ever really sent.",
  },
  {
    id: "06-results",
    text:
      "The activity page shows the approved terms, the simulated outbox, and an audit trail. Apply the ten simulated redemption events. " +
      "Seven hundred rupees in sales, minus four hundred in ingredients and packaging, leaves three hundred rupees of contribution — labeled as simulated outcomes. " +
      "Re-applying the same event changes nothing: the system is idempotent, and the cap of twenty is enforced atomically.",
  },
  {
    id: "07-operations",
    text:
      "The Operations copilot goes beyond a single offer: product run rates, a stock cover and restock plan, and a customer pulse — " +
      "all computed from the same session data, never invented.",
  },
  {
    id: "08-multi-business",
    text:
      "Merchant Saathi is a platform, not one shop. Add business registers any domain — a kirana store, a salon, a tuition center. " +
      "Each business gets its own seeded numbers, its own offers and campaigns, and its own mascot buddy — isolated inside the browser session. " +
      "The header switcher moves between businesses instantly.",
  },
  {
    id: "09-honesty-security",
    text:
      "Judges value honesty. Load the thin data demo: the windows are too small, and the app says insufficient evidence instead of guessing. " +
      "And the engineering: session scoped tenants with authorization guards, a vendor neutral server side model, money computed in integer paise, " +
      "and one hundred six automated tests protecting the invariants.",
  },
  {
    id: "10-credits",
    text:
      "From evidence, to approval, to measurable simulated outcomes — the owner stays in control at every step. " +
      "This project was built with love in Pune by Team FinovateX. " +
      "Team leader: Arya Jannawar. Team members: Siddhant Pardeshi and Avani Jannawar. " +
      "Thank you for watching. Merchant Saathi — proof, not a black box.",
  },
];

function durationSeconds(file) {
  // `ffmpeg -i <file>` prints the duration to stderr and exits non-zero by design.
  let out = "";
  try {
    out = execFileSync(ffmpegPath, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] }).toString();
  } catch (err) {
    out = err.stderr?.toString() ?? "";
  }
  const m = out.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) throw new Error(`No duration found for ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const results = [];

for (const scene of SCENES) {
  const mp3 = path.join(OUT_DIR, `${scene.id}.mp3`);
  const wav = path.join(OUT_DIR, `${scene.id}.wav`);
  const tts = new MsEdgeTTS();
  await tts.setMetadata("en-IN-NeerjaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const readable = tts.toStream(scene.text);
  const chunks = [];
  for await (const chunk of readable.audioStream) chunks.push(chunk);
  fs.writeFileSync(mp3, Buffer.concat(chunks));
  // Convert to WAV for lossless ffmpeg mixing later.
  execFileSync(ffmpegPath, ["-y", "-i", mp3, "-ar", "24000", "-ac", "1", wav], { stdio: ["ignore", "ignore", "ignore"] });
  fs.rmSync(mp3, { force: true });
  const d = durationSeconds(wav);
  results.push({ id: scene.id, wav, seconds: d });
  console.log(`${scene.id}: ${d.toFixed(1)}s`);
}

const total = results.reduce((s, r) => s + r.seconds, 0);
console.log(`TOTAL narration: ${(total / 60).toFixed(1)} min`);
fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(results, null, 2));
console.log("manifest written:", path.join(OUT_DIR, "manifest.json"));
