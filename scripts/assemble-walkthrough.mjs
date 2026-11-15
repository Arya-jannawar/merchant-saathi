/**
 * Assembles the Merchant Saathi walkthrough video:
 *   1. Normalizes each scene clip (docs/media/walkthrough-clips/scene-NN.webm)
 *      to 1280x720 h264 mp4, extending the last frame if the narration is longer.
 *   2. Concatenates the scenes.
 *   3. Places each scene's female-voice narration (docs/media/voiceover/NN-*.wav)
 *      at the scene's start offset and mixes one continuous track.
 *   4. Muxes video + narration into docs/media/merchant-saathi-walkthrough-voice.mp4
 *
 * Tooling (not committed to package.json): npm install --no-save ffmpeg-static
 * Usage: node scripts/assemble-walkthrough.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
const CLIPS = path.resolve(process.cwd(), "docs", "media", "walkthrough-clips");
const VO = path.resolve(process.cwd(), "docs", "media", "voiceover");
const WORK = path.join(CLIPS, "normalized");
const OUT = path.resolve(process.cwd(), "docs", "media", "merchant-saathi-walkthrough-voice.mp4");

function probeDuration(file) {
  let out = "";
  try {
    out = execFileSync(ffmpegPath, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] }).toString();
  } catch (err) {
    out = err.stderr?.toString() ?? "";
  }
  const m = out.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) throw new Error(`No duration for ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Live-recorded webms carry no container duration - decode fully and read the last timestamp. */
function decodeDuration(file) {
  const res = spawnSync(ffmpegPath, ["-i", file, "-f", "null", "-"], { encoding: "utf8" });
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const times = [...out.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  if (times.length === 0) throw new Error(`Could not decode duration for ${file}`);
  const last = times[times.length - 1];
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

function run(args) {
  execFileSync(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
}

const manifest = JSON.parse(fs.readFileSync(path.join(VO, "manifest.json"), "utf8"));
fs.mkdirSync(WORK, { recursive: true });

// 1. Normalize each scene (with silent audio track, tpad if narration outgrows the clip)
const normalized = [];
for (const scene of manifest) {
  const idx = scene.id.split("-")[0]; // "01-dashboard" -> "01"
  const clip = path.join(CLIPS, `scene-${idx}.webm`);
  const out = path.join(WORK, `scene-${idx}.mp4`);
  const clipDur = decodeDuration(clip);
  const needed = scene.seconds + 1.2;
  const pad = Math.max(0, needed - clipDur);
  const vf = `scale=1280:720,fps=15,format=yuv420p${pad > 0.05 ? `,tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}` : ""}`;
  run([
    "-y", "-i", clip,
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
    "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "64k", "-shortest", "-movflags", "+faststart",
    out,
  ]);
  const dur = probeDuration(out);
  normalized.push({ idx, out, dur, narrStart: 0 }); // narrStart filled after offsets known
  console.log(`scene-${idx}: clip ${clipDur.toFixed(1)}s -> ${dur.toFixed(1)}s (narration ${scene.seconds.toFixed(1)}s)`);
}

// 2. Concat
const listFile = path.join(WORK, "list.txt");
fs.writeFileSync(listFile, normalized.map((n) => `file '${n.out.replace(/\\/g, "/")}'`).join("\n"));
const concatFile = path.join(WORK, "concat.mp4");
run(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", concatFile]);
const totalDur = probeDuration(concatFile);
console.log(`concat: ${totalDur.toFixed(1)}s`);

// 3. Narration timeline: each scene's narration starts 0.8s into its scene
let offset = 0;
const mixInputs = [];
const filterParts = [];
const mixLabels = [];
manifest.forEach((scene, i) => {
  const n = normalized[i];
  const startMs = Math.round((offset + 0.8) * 1000);
  mixInputs.push("-i", scene.wav);
  filterParts.push(`[${i}:a]adelay=delays=${startMs}:all=1[d${i}]`);
  mixLabels.push(`[d${i}]`);
  n.narrStart = startMs;
  offset += n.dur;
});
const mixOut = path.join(WORK, "narration.wav");
run([
  "-y",
  ...mixInputs,
  "-filter_complex",
  `${filterParts.join(";")};${mixLabels.join("")}amix=inputs=${manifest.length}:duration=longest:normalize=0[outa]`,
  "-map", "[outa]", "-ar", "24000", "-ac", "1",
  mixOut,
]);

// 4. Final mux
run([
  "-y", "-i", concatFile, "-i", mixOut,
  "-map", "0:v", "-map", "1:a",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "96k",
  "-shortest", "-movflags", "+faststart",
  OUT,
]);
console.log(`FINAL: ${OUT} (${probeDuration(OUT).toFixed(1)}s, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
