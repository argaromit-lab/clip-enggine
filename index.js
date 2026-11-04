import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";

dotenv.config();


const INPUT_DIR = "input";
const OUTPUT_DIR = "output";
const PROJECT_ROOT = process.cwd();
const ASSETS_DIR = "assets";
const TEMP_DIR = "temp";
const CACHE_DIR = "cache";

const SELECTION_LAB_DIR = "selection-lab";

const CHANNELS = {
  social_edit: {
    key: "social_edit",
    label: "THE SOCIAL EDIT",
    shortName: "SOCIAL_EDIT",
    description: "modern dating, relationships, chemistry, social life, and real conversations",
    watermark: "THE SOCIAL EDIT",
    subtitleStyle: "SocialEdit"
  },
  social_table: {
    key: "social_table",
    label: "THE SOCIAL TABLE",
    shortName: "SOCIAL_TABLE",
    description: "food, drinks, dining, table conversations, social moments, and lifestyle",
    watermark: "THE SOCIAL TABLE",
    subtitleStyle: "SocialTable"
  },
  general: {
    key: "general",
    label: "GENERAL — VISUAL HIGHLIGHTS",
    shortName: "GENERAL",
    description: "trailers, cinematic action, gameplay, montages, promos and visual storytelling",
    watermark: "VISUAL HIGHLIGHTS",
    subtitleStyle: "General"
  }
};

function resolveChannels(value) {
  const raw = String(value || "both").toLowerCase().trim();
  if (["social_edit", "edit", "1"].includes(raw)) return [CHANNELS.social_edit];
  if (["social_table", "table", "2"].includes(raw)) return [CHANNELS.social_table];
  if (["general", "visual", "visual_highlights", "3"].includes(raw)) return [CHANNELS.general];
  if (["both", "all"].includes(raw)) return [CHANNELS.social_edit, CHANNELS.social_table, CHANNELS.general];
  return [CHANNELS.social_edit, CHANNELS.social_table, CHANNELS.general];
}

const CFG = {
  channelMode: process.env.CHANNEL_MODE || "both",

  width: 1080,
  height: 1920,
  layout: process.env.SHORTS_LAYOUT || "premium",
  visualVariant: process.env.VISUAL_VARIANT || "auto",
  editorialBeats: String(process.env.EDITORIAL_BEATS || "true").toLowerCase() !== "false",
  editorialBeatMax: Number(process.env.EDITORIAL_BEAT_MAX || 1),
  editorialBeatDuration: Number(process.env.EDITORIAL_BEAT_DURATION || 0.85),
  editorialBeatMinGap: Number(process.env.EDITORIAL_BEAT_MIN_GAP || 8),

  premiumVideoHeight: Number(process.env.PREMIUM_VIDEO_HEIGHT || 720),
  premiumVideoFocusX: Number(process.env.PREMIUM_VIDEO_FOCUS_X || 0.5),
  // Smart Auto-Framing: aim for 85% canvas height, while limiting side crop on landscape sources.
  smartFrameHeightRatio: Math.max(0.70, Math.min(0.90, Number(process.env.SMART_FRAME_HEIGHT_RATIO || 0.90))),
  smartFrameMaxLandscapeCrop: Math.max(0.15, Math.min(0.55, Number(process.env.SMART_FRAME_MAX_LANDSCAPE_CROP || 0.38))),

  subtitleMarginV: Number(process.env.SUBTITLE_MARGIN_V || 280),
  watermark: String(process.env.WATERMARK || "true").toLowerCase() !== "false",
  hookAnimation: String(process.env.HOOK_ANIMATION || "true").toLowerCase() !== "false",
  hookDuration: Number(process.env.HOOK_DURATION || 3),
  hookFontSize: Number(process.env.HOOK_FONT_SIZE || 104),
  hookMarginV: Number(process.env.HOOK_MARGIN_V || 285),
  hookMaxChars: Number(process.env.HOOK_MAX_CHARS || 42),
  hookEntranceMs: Number(process.env.HOOK_ENTRANCE_MS || 260),
  hookStyle: String(process.env.HOOK_STYLE || "auto").toLowerCase(),
  hookAccentAlpha: Number(process.env.HOOK_ACCENT_ALPHA || 0.94),
  hookLargeDuration: Number(process.env.HOOK_LARGE_DURATION || 2.5),
  hookCompactAt: Number(process.env.HOOK_COMPACT_AT || 2.5),
  hookCompactTransition: Number(process.env.HOOK_COMPACT_TRANSITION || 0.7),
  hookCompactY: Number(process.env.HOOK_COMPACT_Y || 154),
  hookPersistentAlpha: Number(process.env.HOOK_PERSISTENT_ALPHA || 0.92),
  hookDesignVariation: String(process.env.HOOK_DESIGN_VARIATION || "auto").toLowerCase(),
  dynamicReframe: {
    enabled: String(process.env.DYNAMIC_REFRAME || "true").toLowerCase() !== "false",
    python: process.env.DYNAMIC_REFRAME_PYTHON || "python",
    script: process.env.DYNAMIC_REFRAME_SCRIPT || path.join(PROJECT_ROOT, "tools", "dynamic_reframe.py"),
    sampleStep: Number(process.env.DYNAMIC_REFRAME_SAMPLE_STEP || 0.25),
    maxDetectWidth: Number(process.env.DYNAMIC_REFRAME_MAX_DETECT_WIDTH || 640),
    smoothing: Number(process.env.DYNAMIC_REFRAME_SMOOTHING || 0.22),
    maxZoom: Number(process.env.DYNAMIC_REFRAME_MAX_ZOOM || 1.045),
    motionPeriod: Number(process.env.DYNAMIC_REFRAME_MOTION_PERIOD || 10),
    faceBias: Number(process.env.DYNAMIC_REFRAME_FACE_BIAS || 0.62),
    cacheVersion: 1
  },
  brandHeader: String(process.env.BRAND_HEADER || "true").toLowerCase() !== "false",

  // Optional campaign watermark, controlled per render job by the dashboard.
  campaignWatermark: {
    mode: String(process.env.CAMPAIGN_WATERMARK_MODE || "off").toLowerCase(),
    text: String(process.env.CAMPAIGN_WATERMARK_TEXT || "").trim().slice(0, 120),
    imagePath: process.env.CAMPAIGN_WATERMARK_IMAGE_PATH ? path.resolve(process.env.CAMPAIGN_WATERMARK_IMAGE_PATH) : "",
    position: String(process.env.CAMPAIGN_WATERMARK_POSITION || "bottom-right").toLowerCase(),
    size: Math.max(64, Math.min(560, Number(process.env.CAMPAIGN_WATERMARK_SIZE || 220))),
    opacity: Math.max(0.15, Math.min(1, Number(process.env.CAMPAIGN_WATERMARK_OPACITY || 0.72))),
    fontSize: Math.max(14, Math.min(80, Number(process.env.CAMPAIGN_WATERMARK_FONT_SIZE || 30))),
    color: String(process.env.CAMPAIGN_WATERMARK_COLOR || "white").toLowerCase(),
    marginX: Math.max(24, Math.min(240, Number(process.env.CAMPAIGN_WATERMARK_MARGIN_X || 54))),
    marginY: Math.max(32, Math.min(300, Number(process.env.CAMPAIGN_WATERMARK_MARGIN_Y || 128))),
    box: String(process.env.CAMPAIGN_WATERMARK_BOX || "true").toLowerCase() !== "false"
  },

  editorialTransform: {
    enabled: String(process.env.EDITORIAL_TRANSFORM || "true").toLowerCase() !== "false",
    motionAmount: Number(process.env.EDITORIAL_MOTION_AMOUNT || 0.026),
    motionPeriod: Number(process.env.EDITORIAL_MOTION_PERIOD || 11),
    beatZoom: Number(process.env.EDITORIAL_BEAT_ZOOM || 1.018),
    beatDuration: Number(process.env.EDITORIAL_BEAT_DURATION || 0.72),
    beatMinGap: Number(process.env.EDITORIAL_BEAT_MIN_GAP || 4.5),
    contextTag: String(process.env.EDITORIAL_CONTEXT_TAG || "true").toLowerCase() !== "false",
    contextDuration: Number(process.env.EDITORIAL_CONTEXT_DURATION || 1.4),
    commentaryAudio: process.env.COMMENTARY_AUDIO || "",
    commentaryVolume: Number(process.env.COMMENTARY_VOLUME || 0.95),
    commentaryDelay: Number(process.env.COMMENTARY_DELAY || 0)
  },

  punchZoom: {
    enabled: String(process.env.PUNCH_ZOOM || "true").toLowerCase() !== "false",
    normal: Number(process.env.PUNCH_ZOOM_NORMAL || 1.00),
    emphasis: Number(process.env.PUNCH_ZOOM_EMPHASIS || 1.045),
    reaction: Number(process.env.PUNCH_ZOOM_REACTION || 1.075),
    hook: Number(process.env.PUNCH_ZOOM_HOOK || 1.025),
    hookDuration: Number(process.env.PUNCH_ZOOM_HOOK_DURATION || 3.0),
    emphasisDuration: Number(process.env.PUNCH_ZOOM_EMPHASIS_DURATION || 0.45),
    reactionDuration: Number(process.env.PUNCH_ZOOM_REACTION_DURATION || 0.65)
  },

  microGraphics: {
    enabled: String(process.env.MICRO_GRAPHICS || "true").toLowerCase() !== "false",
    maxPerClip: Number(process.env.MICRO_GRAPHICS_MAX || 2),
    duration: Number(process.env.MICRO_GRAPHICS_DURATION || 1.15),
    fontSize: Number(process.env.MICRO_GRAPHICS_FONT_SIZE || 30)
  },

  speakerVolume: Number(process.env.SPEAKER_VOLUME || 1),
  bgmVolume: Number(process.env.BGM_VOLUME || 0.06),
  subtitleFont: process.env.SUBTITLE_FONT || "Arial",
  hookFont: process.env.HOOK_FONT || "Impact",
  subtitleSize: Number(process.env.SUBTITLE_FONT_SIZE || 62),
  subtitleWords: Number(process.env.SUBTITLE_MAX_WORDS || 8),
  subtitleMinDuration: Number(process.env.SUBTITLE_MIN_DURATION || 1.05),
  subtitleMaxDuration: Number(process.env.SUBTITLE_MAX_DURATION || 3.2),
  subtitleBreakPause: Number(process.env.SUBTITLE_BREAK_PAUSE || 0.65),
  subtitleMaxChars: Number(process.env.SUBTITLE_MAX_CHARS || 54),
  subtitleMaxLines: Number(process.env.SUBTITLE_MAX_LINES || 2),
  subtitleCacheVersion: 20,
  speakerDiarization: String(process.env.SPEAKER_DIARIZATION || "true").toLowerCase() === "true",
  speakerMax: Math.max(2, Number(process.env.SPEAKER_MAX || 4)),
  speakerGapMax: Math.max(0.0, Number(process.env.SPEAKER_GAP_MAX || 0.25)),
  speakerHardBoundary: String(process.env.SPEAKER_HARD_BOUNDARY || "true").toLowerCase() !== "false",
  subtitleContextPrompt: false,
  subtitlePromptWords: 0,
  subtitleStyle: process.env.SUBTITLE_STYLE || "premium",
  subtitleTransitionGap: Number(process.env.SUBTITLE_TRANSITION_GAP || 0.10),
  subtitleWordPopMs: Number(process.env.SUBTITLE_WORD_POP_MS || 70),
  subtitleWordLeadGuard: Number(process.env.SUBTITLE_WORD_LEAD_GUARD || 0.00),
  subtitleSyncOffsetMs: Number(process.env.SUBTITLE_SYNC_OFFSET_MS || 70),

  whisperxEnabled: String(process.env.WHISPERX_ENABLED || "true").toLowerCase() !== "false",
  whisperxPython: process.env.WHISPERX_PYTHON || "python",
  whisperxScript: process.env.WHISPERX_SCRIPT || path.join(PROJECT_ROOT, "tools", "whisperx_align.py"),
  whisperxDevice: process.env.WHISPERX_DEVICE || "auto",
  whisperxComputeType: process.env.WHISPERX_COMPUTE_TYPE || "int8",
  whisperxTimeoutMs: Number(process.env.WHISPERX_TIMEOUT_MS || 300000),
  whisperxWorker: String(process.env.WHISPERX_WORKER || "true").toLowerCase() !== "false",
  whisperxWorkerScript: process.env.WHISPERX_WORKER_SCRIPT || path.join(PROJECT_ROOT, "tools", "whisperx_worker.py"),
  whisperxWorkerStartupMs: Number(process.env.WHISPERX_WORKER_STARTUP_MS || 45000),
  whisperxCpuThreads: Number(process.env.WHISPERX_CPU_THREADS || 8),
  subtitleLeadGuard: Number(process.env.SUBTITLE_LEAD_GUARD || 0.00),
  subtitleTailGuard: Number(process.env.SUBTITLE_TAIL_GUARD || 0.08),

  useCache: String(process.env.USE_CACHE || "true").toLowerCase() !== "false",

  colorEnhancement: {
    enabled: String(process.env.COLOR_ENHANCEMENT || "true").toLowerCase() !== "false",
    brightness: Number(process.env.COLOR_BRIGHTNESS || 0.035),
    contrast: Number(process.env.COLOR_CONTRAST || 1.06),
    saturation: Number(process.env.COLOR_SATURATION || 1.05),
    gamma: Number(process.env.COLOR_GAMMA || 1.03)
  }
};

function ensureDirs() {
  [INPUT_DIR, OUTPUT_DIR, ASSETS_DIR, TEMP_DIR, CACHE_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function safeName(s) {
  return String(s || "clip")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_").replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "").slice(0, 100);
}

function safeFileTitle(s) {
  // Keep readable spaces/punctuation for the final filename; only remove
  // characters Windows forbids. This makes outputs look like the actual title.
  return String(s || "Untitled Clip")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .replace(/^[_ .]+|[_ .]+$/g, "")
    .slice(0, 110) || "Untitled Clip";
}

function episodeCode(name) {
  const m = String(name || "").match(/\bE\d{2,4}\b/i);
  return m ? m[0].toUpperCase() : safeName(name).slice(0, 24);
}

function clock(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
           : `${m}:${String(s).padStart(2,"0")}`;
}

function assTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
}

function assText(s) {
  // Preserve our intentional ASS line-break marker without rendering a literal backslash.
  const LINE_BREAK = "\u0000";
  return String(s || "")
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\u0000/g, "\\N")
    .replace(/[{}]/g, "");
}

function safeDelete(file) {
  try { if (file && fs.existsSync(file)) fs.unlinkSync(file); } catch {}
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function mediaInfo(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      const v = (meta.streams || []).find(s => s.codec_type === "video");
      resolve({
        duration: Number(meta.format?.duration || 0),
        width: Number(v?.width || 0),
        height: Number(v?.height || 0),
        hasAudio: (meta.streams || []).some(s => s.codec_type === "audio")
      });
    });
  });
}

function renderRanges(video, ranges, out) {
  return new Promise((resolve, reject) => {
    if (!ranges.length) return reject(new Error("Tidak ada range."));
    const parts = [];
    const processNext = async () => {
      try {
        for (let i=0; i<ranges.length; i++) {
          const p = path.join(TEMP_DIR, `${path.basename(out, ".mp4")}__part_${i+1}.mp4`);
          await cut(video, p, ranges[i].start, ranges[i].end);
          parts.push(p);
        }
        const stitched = path.join(TEMP_DIR, `${path.basename(out, ".mp4")}__stitched.mp4`);
        await stitch(parts, stitched);
        return { parts, stitched };
      } catch (e) {
        parts.forEach(safeDelete);
        throw e;
      }
    };
    processNext().then(resolve).catch(reject);
  });
}

function cut(video, out, start, end) {
  return new Promise((resolve, reject) => {
    ffmpeg(video).setStartTime(start).setDuration(Math.max(0.1,end-start))
      .videoCodec("libx264").audioCodec("aac")
      .outputOptions(["-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart"])
      .output(out).on("end",resolve).on("error",reject).run();
  });
}

function stitch(parts, out) {
  return new Promise((resolve,reject) => {
    if (!parts.length) return reject(new Error("Tidak ada part."));
    const list = path.join(TEMP_DIR, `concat_${Date.now()}.txt`);
    fs.writeFileSync(list, parts.map(p => `file '${path.resolve(p).replace(/\\/g,"/").replace(/'/g,"'\\''")}'`).join("\n"), "utf8");

    ffmpeg().input(list).inputOptions(["-f","concat","-safe","0"])
      .videoCodec("libx264").audioCodec("aac")
      .outputOptions(["-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-movflags","+faststart"])
      .output(out).on("end",()=>{ safeDelete(list); resolve(out); })
      .on("error",e=>{ safeDelete(list); reject(e); }).run();
  });
}

function extractClipAudioForAlignment(video, out) {
  return new Promise((resolve, reject) => {
    ffmpeg(video)
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .outputOptions(["-vn", "-ac 1", "-ar 16000"])
      .output(out)
      .on("end", () => resolve(out))
      .on("error", reject)
      .run();
  });
}

async function alignWordsToRenderedClip(stitched, words, stem, duration) {
  if (!CFG.whisperxEnabled || !Array.isArray(words) || !words.length) return words;
  const wav = path.join(TEMP_DIR, `${stem}__align.wav`);
  try {
    await extractClipAudioForAlignment(stitched, wav);
    const aligned = await runWhisperXAlignment(wav, words, `${stem}__clip_alignment`);
    if (!Array.isArray(aligned) || !aligned.length) {
      console.log("    -> Clip-level alignment unavailable; using transcript-cache timestamps.");
      return words;
    }
    const sane = aligned.filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= -0.05 && w.end > w.start && w.end <= duration + 0.75);
    const coverage = sane.length / Math.max(1, words.length);
    if (coverage < 0.60) {
      console.log(`    -> Clip-level alignment rejected (coverage ${(coverage * 100).toFixed(0)}%); using transcript-cache timestamps.`);
      return words;
    }
    const normalized = sane.map(w => ({
      ...w,
      start: Math.max(0, Number(w.start)),
      end: Math.min(duration, Number(w.end))
    })).filter(w => w.end > w.start);
    if (normalized.length < 1) return words;
    console.log(`    -> Clip-level WhisperX alignment accepted: ${normalized.length}/${words.length} words; timestamps local to rendered clip.`);
    return mergeAlignedSpeakers(normalized, words);
  } catch (e) {
    console.log(`    -> Clip-level alignment failed: ${e.message}; using transcript-cache timestamps.`);
    return words;
  } finally {
    safeDelete(wav);
  }
}

let whisperXWorkerProcess = null;
let whisperXWorkerBuffer = "";
let whisperXWorkerSeq = 0;
const whisperXWorkerPending = new Map();
let whisperXWorkerFailed = false;

function rejectWhisperXWorkerPending(reason) {
  for (const [id, pending] of whisperXWorkerPending) {
    clearTimeout(pending.timer);
    try { pending.resolve(null); } catch {}
    whisperXWorkerPending.delete(id);
  }
  if (reason) console.log(`    -> WhisperX worker stopped: ${reason}`);
}

function stopWhisperXWorker() {
  if (!whisperXWorkerProcess) return;
  try { whisperXWorkerProcess.kill(); } catch {}
  whisperXWorkerProcess = null;
  whisperXWorkerBuffer = "";
  rejectWhisperXWorkerPending("process stopped");
}

function ensureWhisperXWorker() {
  if (!CFG.whisperxWorker || whisperXWorkerFailed) return null;
  if (whisperXWorkerProcess && !whisperXWorkerProcess.killed) return whisperXWorkerProcess;
  if (!fs.existsSync(CFG.whisperxWorkerScript)) {
    console.log(`    -> WhisperX worker tidak ditemukan: ${CFG.whisperxWorkerScript}`);
    whisperXWorkerFailed = true;
    return null;
  }

  console.log(`    -> Starting persistent WhisperX worker (CPU threads: ${CFG.whisperxCpuThreads})`);
  const child = spawn(CFG.whisperxPython, [path.resolve(CFG.whisperxWorkerScript)], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, WHISPERX_CPU_THREADS: String(CFG.whisperxCpuThreads) }
  });
  whisperXWorkerProcess = child;
  whisperXWorkerBuffer = "";

  child.stdout.on("data", d => {
    whisperXWorkerBuffer += d.toString();
    let idx;
    while ((idx = whisperXWorkerBuffer.indexOf("\n")) >= 0) {
      const line = whisperXWorkerBuffer.slice(0, idx).trim();
      whisperXWorkerBuffer = whisperXWorkerBuffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const pending = whisperXWorkerPending.get(String(msg.id));
      if (!pending) continue;
      whisperXWorkerPending.delete(String(msg.id));
      clearTimeout(pending.timer);
      if (!msg.ok) {
        if (msg.error) console.log(`    -> WhisperX worker: ${String(msg.error).slice(-1000)}`);
        pending.resolve(null);
      } else if (msg.cmd === "diarize" || pending.kind === "diarization") {
        const turns = (msg.turns || [])
          .map(t => ({ start: Number(t.start), end: Number(t.end), speaker: String(t.speaker || "") }))
          .filter(t => t.speaker && Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start);
        pending.resolve(turns.length ? turns : null);
      } else {
        const alignedWords = (msg.words || [])
          .map(w => ({ word: String(w.word || "").trim(), start: Number(w.start), end: Number(w.end), ...(w.speaker ? {speaker: String(w.speaker)} : {}) }))
          .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
        pending.resolve(alignedWords.length ? alignedWords : null);
      }
    }
  });
  child.stderr.on("data", d => {
    const text = d.toString().trim();
    if (text) console.log(`    -> WhisperX worker: ${text.slice(-1000)}`);
  });
  child.on("error", err => {
    whisperXWorkerFailed = true;
    rejectWhisperXWorkerPending(`start error: ${err.message}`);
    whisperXWorkerProcess = null;
  });
  child.on("close", code => {
    const wasExpected = !whisperXWorkerProcess || whisperXWorkerProcess !== child;
    if (whisperXWorkerProcess === child) whisperXWorkerProcess = null;
    if (!wasExpected && code !== 0) whisperXWorkerFailed = true;
    rejectWhisperXWorkerPending(`exit ${code}`);
  });
  return child;
}

async function runWhisperXWorkerAlignment(audio, words, cacheKey) {
  const child = ensureWhisperXWorker();
  if (!child || !words?.length) return null;
  const id = `${Date.now()}_${++whisperXWorkerSeq}`;
  const timeoutMs = Math.max(30000, CFG.whisperxTimeoutMs);
  const payload = JSON.stringify({
    id,
    audio: path.resolve(audio),
    language: CFG.language,
    words,
    device: CFG.whisperxDevice,
    compute_type: CFG.whisperxComputeType
  }) + "\n";

  console.log(`    -> WhisperX worker alignment: ${CFG.whisperxDevice}/${CFG.whisperxComputeType}`);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (!whisperXWorkerPending.has(id)) return;
      whisperXWorkerPending.delete(id);
      console.log(`    -> WhisperX worker timeout setelah ${timeoutMs}ms; fallback ke Whisper.`);
      // Do not kill the persistent worker. It may still be finishing; mark this
      // request as timed out and allow future requests to use the same worker.
      resolve(null);
    }, timeoutMs);
    whisperXWorkerPending.set(id, { resolve, timer, cacheKey });
    try {
      child.stdin.write(payload);
    } catch (err) {
      clearTimeout(timer);
      whisperXWorkerPending.delete(id);
      console.log(`    -> WhisperX worker write gagal: ${err.message}`);
      resolve(null);
    }
  });
}


function normalizeSpeakerWords(words) {
  if (!Array.isArray(words)) return [];
  const out = words.map(w => ({
    word: String(w.word || "").trim(),
    start: Number(w.start),
    end: Number(w.end),
    ...(w.speaker ? {speaker: String(w.speaker)} : {})
  })).filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  out.sort((a,b) => a.start - b.start || a.end - b.end);
  return out;
}

async function runWhisperXAlignment(audio, words, cacheKey) {
  if (!CFG.whisperxEnabled || !words?.length) return null;
  if (!fs.existsSync(CFG.whisperxScript)) {
    console.log(`    -> WhisperX helper tidak ditemukan: ${CFG.whisperxScript}`);
    return null;
  }

  // V6.6: persistent worker keeps the alignment model loaded once across clips.
  if (CFG.whisperxWorker) {
    const aligned = await runWhisperXWorkerAlignment(audio, words, cacheKey);
    if (aligned) {
      console.log(`    -> WhisperX aligned: ${aligned.length} words`);
      return aligned;
    }
    console.log("    -> WhisperX worker tidak menghasilkan alignment; fallback ke Whisper.");
    return null;
  }

  // Compatibility fallback: one-shot helper process.
  const inputJson = path.join(TEMP_DIR, `${cacheKey}__whisperx_input.json`);
  const outputJson = path.join(TEMP_DIR, `${cacheKey}__whisperx_output.json`);
  writeJson(inputJson, { language: CFG.language, words });
  const args = [CFG.whisperxScript, "--audio", audio, "--input", inputJson, "--output", outputJson, "--language", CFG.language, "--device", CFG.whisperxDevice, "--compute-type", CFG.whisperxComputeType];
  console.log(`    -> WhisperX one-shot alignment: ${CFG.whisperxDevice}/${CFG.whisperxComputeType}`);
  const result = await new Promise(resolve => {
    let stdout = "", stderr = "", settled = false;
    const child = spawn(CFG.whisperxPython, args, { windowsHide: true });
    const timer = setTimeout(() => { if (settled) return; settled = true; try { child.kill(); } catch {} resolve(null); }, CFG.whisperxTimeoutMs);
    child.stdout?.on("data", d => { stdout += d.toString(); });
    child.stderr?.on("data", d => { stderr += d.toString(); });
    child.on("error", () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } });
    child.on("close", code => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0) { console.log(`    -> WhisperX exit ${code}. ${(stderr || stdout).trim().slice(-1000)}`); resolve(null); return; }
      try {
        const aligned = readJson(outputJson);
        const alignedWords = (aligned?.words || []).map(w => ({ word: String(w.word || "").trim(), start: Number(w.start), end: Number(w.end) })).filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
        resolve(alignedWords.length ? alignedWords : null);
      } catch { resolve(null); }
    });
  });
  safeDelete(inputJson); safeDelete(outputJson);
  return result;
}

function mergeAlignedSpeakers(aligned, sourceWords) {
  const out = Array.isArray(aligned) ? aligned.map(w => ({ ...w })) : [];
  const src = Array.isArray(sourceWords) ? sourceWords : [];
  if (!out.length || !src.length) return out;

  // Preserve speaker labels from the master transcript after WhisperX refines timing.
  // WhisperX may return only word/start/end; speaker identity remains authoritative
  // from the master transcript and is copied by sequence/text matching.
  let j = 0;
  for (const a of out) {
    const target = cleanCaptionWord(a.word).toLowerCase();
    let best = -1;
    for (let k = j; k < Math.min(src.length, j + 5); k++) {
      const sw = cleanCaptionWord(src[k].word).toLowerCase();
      if (sw === target) { best = k; break; }
    }
    if (best < 0 && j < src.length) best = j;
    if (best >= 0) {
      if (src[best].speaker) a.speaker = String(src[best].speaker);
      j = best + 1;
    }
  }
  return out;
}

function finalWords(clip, transcript) {
  const out = [];
  let offset = 0;
  const parts = Array.isArray(clip?.ranges) && clip.ranges.length
    ? clip.ranges
    : ["hook", "story", "payoff"]
        .filter(k => clip?.[k])
        .map(k => clip[k]);

  for (const r of parts) {
    const rs = Number(r?.start);
    const re = Number(r?.end);
    if (!Number.isFinite(rs) || !Number.isFinite(re) || re <= rs) continue;
    for (const w of (transcript?.words || [])) {
      const ws = Number(w?.start);
      const we = Number(w?.end);
      if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) continue;
      if (we <= rs || ws >= re) continue;
      const s = Math.max(ws, rs);
      const e = Math.min(we, re);
      if (e > s) {
        out.push({
          word: String(w.word || "").trim(),
          start: offset + s - rs,
          end: offset + e - rs,
          ...(w.speaker ? { speaker: String(w.speaker) } : {})
        });
      }
    }
    offset += re - rs;
  }
  return out.filter(w => w.word && w.end > w.start);
}

function cleanCaptionWord(word) {
  let w = String(word || "").replace(/\s+/g, " ").trim();
  const dict = {
    "because": "'cause", "okay": "ok", "going": "goin'", 
    "doing": "doin'", "nothing": "nothin'", "something": "somethin'", 
    "everyone": "everybody", "really": "literally", "probably": "probly", 
    "cannot": "can't", "do not": "don't", "what is": "what's"
  };
  const cleanMatch = w.toLowerCase().replace(/[^a-z']/g, "");
  if (dict[cleanMatch]) {
    w = w.replace(new RegExp(cleanMatch, "i"), dict[cleanMatch]);
  }
  return w;
}

function captionText(words) {
  const raw = words.map(w => cleanCaptionWord(w.word)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const parts = raw.split(" ");
  if (parts.length <= 1) return raw;
  const target = Math.ceil(parts.length / 2);
  let best = null;
  for (let i = Math.max(1, target - 2); i <= Math.min(parts.length - 1, target + 2); i++) {
    const a = parts.slice(0, i).join(" ");
    const b = parts.slice(i).join(" ");
    const score = Math.abs(a.length - b.length) + (a.length > 30 ? 8 : 0) + (b.length > 30 ? 8 : 0);
    if (!best || score < best.score) best = { i, score, a, b };
  }
  return `${best.a}\u0000${best.b}`;
}

function inferMissingSpeakers(words) {
  // Speaker identity is authoritative when diarization has labeled a word.
  // Unlabeled words inherit the nearest active speaker only across a very short
  // gap; we never bridge a genuine conversational pause.
  const out = (words || []).map(w => ({ ...w }));
  let lastSpeaker = null;
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (w.speaker) {
      lastSpeaker = String(w.speaker);
      continue;
    }
    const prev = i > 0 ? out[i - 1] : null;
    const next = i + 1 < out.length ? out[i + 1] : null;
    const prevGap = prev ? Math.max(0, Number(w.start) - Number(prev.end)) : Infinity;
    const nextGap = next ? Math.max(0, Number(next.start) - Number(w.end)) : Infinity;
    if (lastSpeaker && prev && prev.speaker && prevGap <= CFG.speakerGapMax) {
      w.speaker = String(lastSpeaker);
    } else if (next?.speaker && nextGap <= CFG.speakerGapMax) {
      w.speaker = String(next.speaker);
    }
  }
  return out;
}

function makeSpeakerStreamEvents(words) {
  // V7.6: streaming speaker-aware captions.
  // A subtitle stream belongs to exactly one active speaker. The stream is
  // broken immediately on a speaker change; no caption event can contain
  // words from two different speakers. Each event is a small rolling phrase,
  // not a long precomposed dialogue block.
  const clean = inferMissingSpeakers((words || [])
    .filter(w => w && w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map(w => ({ ...w, start: Number(w.start), end: Number(w.end) }))
    .sort((a,b) => a.start - b.start || a.end - b.end));

  const deduped = [];
  for (const w of clean) {
    const prev = deduped[deduped.length - 1];
    const a = cleanCaptionWord(w.word).toLowerCase();
    const b = prev ? cleanCaptionWord(prev.word).toLowerCase() : "";
    if (prev && a === b && Math.abs(w.start - prev.start) < 0.22 && (!w.speaker || !prev.speaker || w.speaker === prev.speaker)) {
      prev.end = Math.max(prev.end, w.end);
      continue;
    }
    deduped.push(w);
  }

  const events = [];
  let run = [];
  let speaker = null;

  const flushRun = () => {
    if (!run.length) return;
    // Split one speaker's continuous turn into short rolling phrases so the
    // subtitle adapts to speech instead of presenting a large static block.
    let idx = 0;
    while (idx < run.length) {
      const group = [];
      let chars = 0;
      let start = Number(run[idx].start);
      for (; idx < run.length && group.length < CFG.subtitleWords; idx++) {
        const w = run[idx];
        const nextChars = chars ? chars + 1 + cleanCaptionWord(w.word).length : cleanCaptionWord(w.word).length;
        const duration = Number(w.end) - start;
        const naturalPause = group.length > 0 && Number(w.start) - Number(group[group.length - 1].end) > CFG.subtitleBreakPause;
        const sentenceEnded = group.length > 0 && /[.!?]["')\]]*$/.test(String(group[group.length - 1].word || ""));
        if (group.length && (nextChars > CFG.subtitleMaxChars || duration > CFG.subtitleMaxDuration || naturalPause || sentenceEnded)) break;
        group.push(w);
        chars = nextChars;
      }
      if (!group.length) { group.push(run[idx]); idx++; }
      const s = Number(group[0].start);
      const e = Number(group[group.length - 1].end);
      events.push({
        start: Math.max(0, s + CFG.subtitleLeadGuard),
        end: Math.max(s + 0.30, e + CFG.subtitleTailGuard),
        text: captionText(group),
        words: group.slice(),
        speaker: group[0].speaker || speaker || null
      });
    }
    run = [];
  };

  for (const w of deduped) {
    const sp = w.speaker ? String(w.speaker) : null;
    if (speaker && sp && sp !== speaker) {
      flushRun();
      speaker = sp;
    } else if (!speaker && sp) {
      speaker = sp;
    }
    if (!run.length && sp) speaker = sp;
    run.push(w);
  }
  flushRun();

  // Hard non-overlap. A speaker change always wins over tail padding.
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = { ...events[i] };
    if (i < events.length - 1) e.end = Math.min(e.end, events[i + 1].start - Math.max(0.05, CFG.subtitleTransitionGap));
    if (e.end > e.start + 0.30) out.push(e);
  }
  return out;
}

function assColorForChannel(channel) {
  // ASS uses &HAABBGGRR. These are intentionally renderer-only visual accents.
  return channel.key === "social_table" ? "&H00D6B36A" : "&H00F05A72";
}

function normalizeHookPunctuation(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([!?])\1{1,}/g, "$1")
    .replace(/!+\?+/g, "?")
    .replace(/\?+!+/g, "?")
    .replace(/\.{2,}/g, ".")
    .replace(/,\s*,+/g, ",")
    .replace(/:\s*:/g, ":")
    .replace(/\s*[-–—]\s*[-–—]+/g, " - ")
    .replace(/\s*—\s*/g, " — ")
    .trim();
}

function removeHookBrand(text) {
  let out = String(text || "");
  for (const label of ["THE SOCIAL EDIT", "SOCIAL EDIT", "THE SOCIAL TABLE", "SOCIAL TABLE"]) {
    out = out.replace(new RegExp(`\\b${label.replace(/ /g, "\\\\s+")}\\b`, "gi"), " ");
  }
  return out.replace(/\s*[:|•·]+\s*$/g, "").replace(/\s*[-–—]\s*$/g, "").replace(/\s{2,}/g, " ").trim();
}

function sanitizeHookCandidate(value) {
  let text = String(value || "");
  text = text
    .replace(/\r?\n/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/\\(?:an|pos|move|fad|fade|fs|fscx|fscy|bord|shad|blur|alpha|1c|2c|3c|4c|c|fn|frx|fry|fr|t)\b[^\s]*/gi, " ")
    .replace(/(?:shad\s*\d+|bord\s*\d+(?:\.\d+)?|alpha\s*&?h?[0-9a-f]+|[1-4]c\s*&?h?[0-9a-f]+)/gi, " ")
    .replace(/&H[0-9A-F]{2,}/gi, " ")
    .replace(/\\/g, " ")
    .replace(/[{}]/g, " ");
  text = text.replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'").replace(/[–—]/g, " — ").replace(/\s+/g, " ").trim();
  text = text.replace(/^[\"'“”‘’]+|[\"'“”‘’]+$/g, "").trim();
  text = normalizeHookPunctuation(removeHookBrand(text));
  if (/(?:shad|bord|alpha|fscx|fscy|pos|fad|\b[1-4]c\b|&H[0-9A-F])/i.test(text)) return "";
  return text;
}

function dynamicHookFromContext(clip, words, channel) {
  const context = [
    clip?.title, clip?.reason, clip?.hookReason,
    clip?.judge?.primaryReason, clip?.editorialValue?.reasons?.join(" "),
    ...(Array.isArray(clip?.tags) ? clip.tags : []),
    ...(Array.isArray(clip?.visualTags) ? clip.visualTags : []),
    ...(Array.isArray(clip?.emphasisWords) ? clip.emphasisWords : []),
    ...(Array.isArray(words) ? words.slice(0, 18).map(w => w?.word) : [])
  ].filter(Boolean).join(" ").toLowerCase();

  let options;
  if (channel.key === "social_edit") {
    if (/confess|secret|reveal|truth/.test(context)) {
      options = ["THE TRUTH COMES OUT", "A SECRET REVEALED", "THAT WAS UNEXPECTED"];
    } else if (/argument|fight|wrong|disagree|red flag|dealbreaker|controvers/.test(context)) {
      options = ["WHO'S IN THE WRONG?", "WOULD YOU AGREE?", "THAT'S A RED FLAG"];
    } else if (/emotion|heart|love|breakup|relationship|dating|chemistry|romance/.test(context)) {
      options = ["THAT HIT DIFFERENT", "THE FEELING IS REAL", "A MOMENT THAT MATTERS"];
    } else {
      options = ["THE CONVERSATION TURNS", "THAT CHANGES THE MOOD", "THERE'S MORE TO THIS"];
    }
  } else if (channel.key === "social_table") {
    if (/food|dish|chef|taste|cook|recipe|restaurant|dining|meal|ingredient/.test(context)) {
      options = ["WOULD YOU TRY THIS?", "WORTH A TASTE?", "THIS DESERVES A DEBATE"];
    } else if (/price|expensive|cheap|worth|value|cost/.test(context)) {
      options = ["WORTH THE HYPE?", "IS IT WORTH IT?", "WHAT WOULD YOU PAY?"];
    } else if (/debate|opinion|agree|disagree|controvers/.test(context)) {
      options = ["WHO MAKES THE BETTER POINT?", "LET'S SETTLE THIS", "WHAT'S YOUR TAKE?"];
    } else {
      options = ["WHAT'S YOUR TAKE?", "WOULD YOU AGREE?", "LET'S TALK ABOUT THIS"];
    }
  } else {
    if (/action|fight|battle|explosion|war|game|gameplay|trailer|chase/.test(context)) {
      options = ["THAT ESCALATED FAST", "PURE CHAOS", "DID YOU SEE THAT?"];
    } else if (/reveal|twist|surprise|secret|unexpected/.test(context)) {
      options = ["DID YOU CATCH THAT?", "HERE'S THE TWIST", "LOOK AGAIN"];
    } else if (/visual|cinematic|scene|shot|detail|moment/.test(context)) {
      options = ["LOOK AT THAT DETAIL", "A SHOT WORTH REPLAYING", "TAKE A CLOSER LOOK"];
    } else {
      options = ["WORTH A SECOND LOOK", "DID YOU CATCH THAT?", "LOOK CLOSER"];
    }
  }

  // Stable variation: the same clip receives the same hook on every render.
  const seed = sha256(context || String(clip?.title || channel.key));
  return options[parseInt(seed.slice(0, 8), 16) % options.length];
}

function hookTextForClip(clip, words, channel) {
  const candidates = [clip?.hookText, clip?.hook?.text, clip?.topHook, clip?.title];
  let text = "";
  const genericHook = /^(?:watch this moment|don't miss this moment|dont miss this moment|this moment|wait for it|watch till the end|you need to see this|look at this)$/i;

  for (const candidate of candidates) {
    const clean = sanitizeHookCandidate(candidate);
    if (clean && !genericHook.test(clean)) {
      text = clean;
      break;
    }
  }

  if (!text) text = dynamicHookFromContext(clip, words, channel);

  const maxChars = Math.max(18, Number(CFG.hookMaxChars || 42));
  if (text.length > maxChars) {
    const limit = Math.max(18, maxChars - 1), wordsOut = text.split(/\s+/), kept=[]; let len=0;
    for (const word of wordsOut) { const n=len ? len+1+word.length : word.length; if(n>limit) break; kept.push(word); len=n; }
    text = kept.join(" ").trim() || String(wordsOut[0] || "").slice(0,limit);
    text += "…";
  }
  return text;
}
function wrapHookText(text, maxLineChars = 24) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0];
  let best=null;
  for(let i=1;i<words.length;i++){
    const a=words.slice(0,i).join(" "), b=words.slice(i).join(" ");
    if(a.length>maxLineChars*1.35 || b.length>maxLineChars*1.35) continue;
    const score=Math.abs(a.length-b.length)+Math.max(0,a.length-maxLineChars)*2+Math.max(0,b.length-maxLineChars)*2;
    if(!best||score<best.score) best={a,b,score};
  }
  if(best) return `${best.a}\u0000${best.b}`;
  const mid=Math.ceil(words.length/2); return `${words.slice(0,mid).join(" ")}\u0000${words.slice(mid).join(" ")}`;
}

function hookWordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function visualProfileFor(channel, clip, words = []) {
  const hook = hookTextForClip(clip, words, channel);
  const variation = designVariationFor(hook, channel, clip);
  const profiles = {
    editorial: { punch: 1.00, micro: 1.00 },
    minimal:   { punch: 0.88, micro: 0.70 },
    bold:      { punch: 1.15, micro: 1.30 },
    floating:  { punch: 0.96, micro: 0.90 }
  };
  return { variation, ...(profiles[variation] || profiles.editorial) };
}

function hookStyleForText(text, channel) {
  const forced=CFG.hookStyle;
  if(["editorial","spotlight","split","bold","compact","question"].includes(forced)) return forced;
  const n=String(text||"").trim().split(/\s+/).filter(Boolean).length;
  if(n<=5) return "bold";
  if(n<=9) return "editorial";
  if(n<=14) return "split";
  if(String(text).includes("?")) return "question";
  return "compact";
}

function designVariationFor(text, channel, clip) {
  if(CFG.hookDesignVariation !== "auto") return CFG.hookDesignVariation;
  const seedText=`${channel.key}|${clip?.title||""}|${text}`;
  const seed=Array.from(seedText).reduce((n,ch)=>(n*31+ch.charCodeAt(0))>>>0,channel.key==="social_table"?17:7);
  return ["editorial","minimal","bold","floating"][seed%4];
}

function makeTopHookEvent(words, channel, clip) {
  if (!CFG.hookAnimation) return "";

  const clipEnd = Array.isArray(words) && words.length
    ? Math.max(...words.map(w => Number(w.end) || 0))
    : Number(CFG.hookDuration || 3);
  const duration = Math.max(4, clipEnd);
  const largeDuration = Math.max(1.8, Math.min(3.2, Number(CFG.hookLargeDuration || 2.5)));
  const compactAt = Math.max(1.5, Math.min(largeDuration, Number(CFG.hookCompactAt || 2.5)));
  const transition = Math.max(.35, Math.min(1.2, Number(CFG.hookCompactTransition || .7)));
  const entrance = Math.max(80, Math.min(700, Number(CFG.hookEntranceMs || 260)));
  const accent = assColorForChannel(channel);
  const rawText = hookTextForClip(clip, words, channel);
  const wrapped = wrapHookText(rawText, 24);
  const safe = assText(wrapped);
  const twoLines = wrapped.includes("\u0000");
  const style = hookStyleForText(rawText, channel);
  const variation = designVariationFor(rawText, channel, clip);
  const events = [];
  const push = (layer, txt, st, en, sty = "HookEditText") =>
    events.push(`Dialogue: ${layer},${assTime(st)},${assTime(en)},${sty},,0,0,0,,${txt}\n`);

  // Refined V7.9 hook: footage remains visible. No filled black rectangle.
  // Hierarchy comes from typography, outline/shadow and a restrained accent rule.
  const textY = twoLines ? 190 : 215;
  const fontSize = Math.max(56, Number(CFG.hookFontSize || 64));
  const align = style === "split" ? "\\an7\\pos(82,170)" : `\\an8\\pos(540,${textY})`;
  const textTag = style === "split"
    ? `{${align}\\fad(${entrance},120)\\fscx92\\fscy92\\t(0,${entrance},\\fscx100\\fscy100)\\fn${CFG.hookFont || "Impact"}\\fs${fontSize}\\b1\\bord4\\shad3\\1c&H00FFFFFF\\3c${accent}}`
    : `{\\an8\\pos(540,${textY})\\fad(${entrance},120)\\fscx92\\fscy92\\t(0,${entrance},\\fscx100\\fscy100)\\fn${CFG.hookFont || "Impact"}\\fs${fontSize + (style === "bold" || variation === "bold" ? 10 : 0)}\\b1\\bord4\\shad3\\1c&H00FFFFFF\\3c${accent}}`;

  // Main hook text only. Brand is rendered by BRAND_HEADER separately.
  push(11, `${textTag}${safe}`, 0, largeDuration, "HookEditText");

  // NOTE: Garis bawah (accent rule) untuk hook 3 detik pertama 
  // sengaja dihapus agar tampilan multi-line jauh lebih bersih dan modern.

  // Collapse into a lightweight floating label. Still no filled black pill.
  const compactY = Number(CFG.hookCompactY || 154);
  const pillText = rawText.split(/\s+/).slice(0, 6).join(" ") + (hookWordCount(rawText) > 6 ? "…" : "");
  const pillSafe = assText(pillText);
  const compactSize = Math.max(27, Math.min(38, fontSize * .48));
  const compactRuleWidth = Math.min(720, Math.max(220, 105 + pillText.length * 10));
  const compactLeft = Math.round((1080 - compactRuleWidth) / 2);
  const compactRight = 1080 - compactLeft;
  const compactRule = `{\\an7\\pos(0,0)\\fad(180,180)\\1c${accent}\\alpha&H08&\\p1}m ${compactLeft} ${compactY + 25} l ${compactRight} ${compactY + 25} l ${compactRight} ${compactY + 29} l ${compactLeft} ${compactY + 29} l ${compactLeft} ${compactY + 25}{\\p0}`;

  push(12,
    `{\\an5\\pos(540,${compactY})\\fad(120,160)\\fscx78\\fscy78\\bord3\\shad2\\1c&H00FFFFFF\\3c${accent}}${pillSafe}`,
    compactAt,
    Math.min(duration, compactAt + transition),
    "HookEditText"
  );
  push(13, compactRule, Math.max(0, compactAt - .12), duration, "HookBox");
  push(14,
    `{\\an5\\pos(540,${compactY})\\fad(180,200)\\fs${compactSize}\\b1\\bord3\\shad2\\1c&H00FFFFFF\\3c${accent}}${pillSafe}`,
    Math.max(0, compactAt - .12),
    duration,
    "HookEditText"
  );
  push(15,
    `{\\an5\\pos(${Math.max(28, compactLeft - 18)},${compactY})\\fad(180,200)\\fs18\\1c${accent}}●`,
    Math.max(0, compactAt - .12),
    duration,
    "HookEditText"
  );

  return events.join("");
}

function microGraphicEvents(words, channel, clip) {
  if (!CFG.microGraphics.enabled || !Array.isArray(words) || !words.length) return [];
  const profile = visualProfileFor(channel, clip, words);
  const maxPerClip = Math.max(0, Math.min(4, Math.round(Number(CFG.microGraphics.maxPerClip || 2) * profile.micro)));
  if (!maxPerClip) return [];
  const duration = Math.max(0.6, Math.min(2.0, Number(CFG.microGraphics.duration || 1.15)));
  const emph = new Set((clip?.emphasisWords || []).map(x => String(x).replace(/[^A-Za-z!?']/g, "").toLowerCase()).filter(Boolean));
  const candidates = [];
  for (const w of words) {
    const raw = cleanCaptionWord(w?.word);
    const normalized = raw.replace(/[^A-Za-z!?']/g, "").toLowerCase();
    if (!raw || !Number.isFinite(Number(w.start))) continue;
    if (Number(w.start) < 3.0) continue;
    const punctuation = /[!?]$/.test(raw);
    const explicit = emph.has(normalized);
    if (!punctuation && !explicit) continue;
    candidates.push({
      t: Number(w.start),
      label: explicit ? raw.replace(/[!?]+$/, "").toUpperCase() : punctuation ? raw.toUpperCase() : ""
    });
  }
  const chosen = [];
  for (const c of candidates) {
    if (!c.label) continue;
    if (chosen.some(x => Math.abs(x.t - c.t) < 4.0)) continue;
    chosen.push(c);
    if (chosen.length >= maxPerClip) break;
  }
  const accent = assColorForChannel(channel);
  return chosen.map((c, i) => {
    const start = Math.max(0, c.t - 0.08);
    const end = start + duration;
    const y = channel.key === "social_table" ? 360 : 420;
    const text = `{\\an7\\pos(82,${y})\\fad(90,140)\\bord3\\shad2\\1c&H00FFFFFF\\3c${accent}\\fs${CFG.microGraphics.fontSize || 30}}${assText(c.label)}`;
    return `Dialogue: ${20 + i},${assTime(start)},${assTime(end)},Micro,,0,0,0,,${text}\n`;
  });
}


function runDynamicReframe(video) {
  if (!CFG.dynamicReframe.enabled) return Promise.resolve(null);
  const script = path.resolve(CFG.dynamicReframe.script);
  if (!fs.existsSync(script)) {
    console.log(`    [FRAMING] tracker script tidak ditemukan: ${script}`);
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    const child = spawn(CFG.dynamicReframe.python, [
      script,
      path.resolve(video),
      String(Math.max(0.10, CFG.dynamicReframe.sampleStep)),
      String(Math.max(320, CFG.dynamicReframe.maxDetectWidth))
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("error", e => {
      console.log(`    [FRAMING] tracker gagal dijalankan: ${e.message}`);
      resolve(null);
    });
    child.on("close", code => {
      if (code !== 0) {
        if (stderr.trim()) console.log(`    [FRAMING] tracker: ${stderr.trim().slice(0, 300)}`);
        resolve(null);
        return;
      }
      try {
        const data = JSON.parse(stdout.trim());
        if (!Array.isArray(data?.samples) || !data.samples.length) {
          if (data?.tracker === "unavailable" || data?.tracker === "cascade_unavailable") {
            const reason = stderr.trim() || "OpenCV face tracker unavailable";
            console.log(`    [FRAMING] tracker unavailable: ${reason.slice(0, 260)}`);
          }
          resolve(null);
          return;
        }
        resolve(data);
      } catch {
        resolve(null);
      }
    });
  });
}

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

function focusAtTime(profile, t) {
  const samples = Array.isArray(profile?.samples) ? profile.samples : [];
  if (!samples.length) return { x: 0.5, y: 0.5, confidence: 0 };
  const time = Math.max(0, Number(t) || 0);
  let a = samples[0], b = samples[samples.length - 1];
  for (let i = 1; i < samples.length; i++) {
    if (Number(samples[i].t) >= time) { b = samples[i]; a = samples[Math.max(0, i - 1)]; break; }
  }
  const at = Number(a.t), bt = Number(b.t);
  const u = bt > at ? clamp01((time - at) / (bt - at)) : 0;
  return {
    x: clamp01(Number(a.x) + (Number(b.x) - Number(a.x)) * u),
    y: clamp01(Number(a.y) + (Number(b.y) - Number(a.y)) * u),
    confidence: Math.max(Number(a.confidence || 0), Number(b.confidence || 0))
  };
}

function dynamicFocusExpression(profile, axis = "x") {
  const samples = Array.isArray(profile?.samples) ? profile.samples : [];
  if (!samples.length) return "0.5";
  let expr = Number(axis === "x" ? samples[0].x : samples[0].y).toFixed(4);
  for (let i = samples.length - 1; i >= 1; i--) {
    const s = samples[i];
    const prev = samples[i - 1];
    const t0 = Number(prev.t).toFixed(3);
    const t1 = Number(s.t).toFixed(3);
    const v0 = Number(axis === "x" ? prev.x : prev.y).toFixed(4);
    const v1 = Number(axis === "x" ? s.x : s.y).toFixed(4);
    const span = Math.max(0.001, Number(s.t) - Number(prev.t));
    const u = `clip((t-${t0})/${span.toFixed(4)},0,1)`;
    const val = `(${v0}+(${v1}-${v0})*${u})`;
    expr = `if(between(t,${t0},${t1}),${val},${expr})`;
  }
  return expr;
}

function dynamicZoomExpression(windows, channel, clip) {
  const maxZoom = Math.max(1, Number(CFG.dynamicReframe.maxZoom || 1.045));
  const period = Math.max(6, Number(CFG.dynamicReframe.motionPeriod || 10));
  const variation = visualProfileFor(channel, clip, []).variation;
  const amp = variation === "bold" ? Math.min(maxZoom - 1, 0.042) : variation === "minimal" ? Math.min(maxZoom - 1, 0.026) : Math.min(maxZoom - 1, 0.035);
  // Smooth deterministic Ken Burns cycle: 1.00 -> max -> 1.00, no snapping.
  const base = `(1+${amp.toFixed(4)}*(0.5-0.5*cos(2*PI*t/${period.toFixed(3)})))`;
  let expr = base;
  for (const w of [...(windows || [])].sort((a,b) => b.start - a.start)) {
    const z = Math.min(maxZoom + 0.035, Number(w.zoom) || 1).toFixed(4);
    expr = `if(between(t,${Number(w.start).toFixed(3)},${Number(w.end).toFixed(3)}),max(${base},${z}),${expr})`;
  }
  return expr;
}

function dynamicSubtitleTag(profile, time) {
  const f = focusAtTime(profile, time);
  let y;
  if (f.y < 0.34) y = 1360;
  else if (f.y < 0.58) y = 1250;
  else y = 1010;
  let x = 540;
  if (f.x < 0.34) x = 690;
  else if (f.x > 0.66) x = 390;
  return `{\\an2\\pos(${x},${y})\\fs${CFG.subtitleSize}\\bord3\\shad2\\fn${CFG.subtitleFont || "Arial"}}`; 
}

function makeEditorialPacingWindows(words, clip, channel = CHANNELS.social_edit) {
  if (!CFG.editorialTransform.enabled || !Array.isArray(words) || words.length < 4) return [];
  const out = [];
  const clipEnd = Math.max(...words.map(w => Number(w.end) || 0));
  const emph = new Set((clip?.emphasisWords || []).map(x => String(x).replace(/[^A-Za-z!?']/g, "").toLowerCase()).filter(Boolean));
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1], next = words[i];
    const gap = Math.max(0, Number(next.start) - Number(prev.end));
    const punct = /[.!?]$/.test(String(prev.word || ""));
    const emphPrev = emph.has(String(prev.word || "").replace(/[^A-Za-z!?']/g, "").toLowerCase());
    if (gap < 0.42 && !punct && !emphPrev) continue;
    const t = Number(prev.end) + Math.min(gap * 0.28, 0.16);
    if (t < 3.0 || t > clipEnd - 1.5) continue;
    if (out.some(x => Math.abs(x.start - t) < Number(CFG.editorialTransform.beatMinGap || 4.5))) continue;
    const strength = punct || emphPrev ? 1.0 : 0.65;
    out.push({
      start: Math.max(0, t - 0.12),
      end: Math.min(clipEnd, t + Number(CFG.editorialTransform.beatDuration || 0.72)),
      zoom: 1 + (Number(CFG.editorialTransform.beatZoom || 1.018) - 1) * strength,
      type: punct ? "sentence" : "breath"
    });
    if (out.length >= 5) break;
  }
  return out;
}

function makePunchZoomWindows(words, clip, channel = CHANNELS.social_edit) {
  if (!CFG.punchZoom.enabled || !Array.isArray(words) || !words.length) return [];
  const out = [];
  const profile = visualProfileFor(channel, clip, words);
  const punchScale = Number(profile.punch || 1);
  const hookDuration = Math.max(0.5, Number(CFG.punchZoom.hookDuration || 3));
  out.push({ start: 0, end: hookDuration, zoom: 1 + (Number(CFG.punchZoom.hook || 1.025) - 1) * punchScale, type: "hook" });
  const emph = new Set((clip?.emphasisWords || []).map(x => String(x).replace(/[^A-Za-z!?']/g, "").toLowerCase()).filter(Boolean));
  for (const w of words) {
    const raw = cleanCaptionWord(w?.word);
    const n = raw.replace(/[^A-Za-z!?']/g, "").toLowerCase();
    if (!raw || !Number.isFinite(Number(w.start)) || Number(w.start) < hookDuration) continue;
    const reaction = /[!?]$/.test(raw);
    const explicit = emph.has(n);
    if (!reaction && !explicit) continue;
    const start = Math.max(0, Number(w.start) - 0.05);
    const dur = reaction ? Number(CFG.punchZoom.reactionDuration || 0.65) : Number(CFG.punchZoom.emphasisDuration || 0.45);
    const baseZoom = reaction ? Number(CFG.punchZoom.reaction || 1.075) : Number(CFG.punchZoom.emphasis || 1.045);
    const zoom = 1 + (baseZoom - 1) * punchScale;
    if (out.some(x => Math.abs(x.start - start) < 1.0)) continue;
    out.push({ start, end: start + dur, zoom, type: reaction ? "reaction" : "emphasis" });
    if (out.length >= 7) break;
  }
  return out;
}

function punchZoomExpression(windows) {
  let expr = "1.0";
  for (const w of [...(windows || [])].sort((a,b) => b.start - a.start)) {
    const z = Number(w.zoom).toFixed(4);
    const st = Number(w.start).toFixed(3);
    const en = Number(w.end).toFixed(3);
    const span = Math.max(0.05, Number(w.end) - Number(w.start));
    const u = `clip((t-${st})/${span.toFixed(4)},0,1)`;
    const smooth = `((${u})*(${u})*(3-2*(${u})))`;
    const val = `(1+(${z}-1)*${smooth})`;
    expr = `if(between(t,${st},${en}),${val},${expr})`;
  }
  return expr;
}

function dynamicPacingExpression(punchWindows, pacingWindows, channel, clip) {
  const profile = visualProfileFor(channel, clip, []);
  const period = Math.max(7, Number(CFG.editorialTransform.motionPeriod || 11));
  const amount = Math.max(0.006, Math.min(0.055, Number(CFG.editorialTransform.motionAmount || 0.026) * (profile.variation === "minimal" ? 0.72 : profile.variation === "bold" ? 1.12 : 1)));
  const base = `(1+${amount.toFixed(4)}*(0.5-0.5*cos(2*PI*t/${period.toFixed(3)})))`;
  let expr = base;
  for (const w of [...(pacingWindows || []), ...(punchWindows || [])].sort((a,b) => b.start-a.start)) {
    const st=Number(w.start).toFixed(3), en=Number(w.end).toFixed(3);
    const z=Math.min(1.12, Number(w.zoom)||1).toFixed(4);
    const span=Math.max(0.05,Number(w.end)-Number(w.start));
    const u=`clip((t-${st})/${span.toFixed(4)},0,1)`;
    const smooth=`((${u})*(${u})*(3-2*(${u})))`;
    const val=`(1+(${z}-1)*${smooth})`;
    expr=`if(between(t,${st},${en}),max(${base},${val}),${expr})`;
  }
  return expr;
}

function makeKineticLine(line, eventStart, emphasisWords = [], channel = CHANNELS.social_edit) {
  // V7.6 speaker-stream compatible kinetic phrase renderer.
  // The caller guarantees that `line` belongs to exactly one speaker turn.
  // Geometry stays fixed; words reveal in audio order; emphasis never changes
  // font size or the line-break position.
  const source = Array.isArray(line) ? line : [];
  const words = source.map(w => cleanCaptionWord(w?.word)).filter(Boolean);
  if (!words.length) return "";

  let split = words.length;
  if (words.length >= 4) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      const score = Math.abs(a.length - b.length) + (a.length > 30 ? 8 : 0) + (b.length > 30 ? 8 : 0);
      if (!best || score < best.score) best = { i, score };
    }
    if (best) split = best.i;
  }

  const configuredEmphasis = new Set((emphasisWords || [])
    .map(x => String(x).replace(/[^A-Za-z!?']/g, "").toLowerCase())
    .filter(Boolean));
  const emphRe = /^(really|seriously|wait|no|never|love|date|friends|red|flag|confession|honestly|why|wow|crazy|actually|literally|maybe|sorry)$/i;
  const fadeMs = Math.max(40, Math.min(120, Number(CFG.subtitleWordPopMs || 70)));
  const leadGuard = Math.max(0, Number(CFG.subtitleWordLeadGuard || 0));
  const syncOffset = Math.max(0, Number(CFG.subtitleSyncOffsetMs || 0)) / 1000;

  return source.map((w, idx) => {
    const word = cleanCaptionWord(w?.word);
    if (!word) return "";
    const delay = Math.max(0, Math.round((Number(w.start || eventStart) - Number(eventStart) + leadGuard + syncOffset) * 1000));
    const safeDelay = Math.max(0, Math.min(delay, 5000));
    const end = safeDelay + fadeMs;
    const normalizedWord = word.replace(/[^A-Za-z!?']/g, "").toLowerCase();
    const emph = configuredEmphasis.has(normalizedWord)
      || emphRe.test(word.replace(/[^A-Za-z!?']/g, ""))
      || /[!?]$/.test(word);
    const accent = assColorForChannel(channel);
    const tag = `{\\alpha&HFF&\\t(${safeDelay},${end},\\alpha&H00&)${emph ? `\\bord3\\shad2\\1c${accent}` : '\\bord3\\shad2\\1c&H00FFFFFF'}}`;
    const token = `${tag}${assText(word)}`;
    return idx === split - 1 && split < words.length ? `${token}\\N` : token;
  }).join(" ");
}

function findEditorialBeats(words, channel) {
  if (!CFG.editorialBeats || !words?.length) return [];
  const clean = words.filter(w => w && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
  if (clean.length < 8) return [];
  const clipEnd = Math.max(...clean.map(w => Number(w.end)));
  const candidates = [];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1], next = clean[i];
    const gap = Number(next.start) - Number(prev.end);
    const t = (Number(prev.end) + Number(next.start)) / 2;
    // Identity beat needs a real silent pocket; never cover spoken audio.
    if (gap < 0.95) continue;
    // Never interrupt the cold open or the payoff.
    if (t < 5.5 || t > clipEnd - 3.0) continue;
    const score = gap + (/[.!?]$/.test(String(prev.word || "")) ? 0.75 : 0);
    candidates.push({ t, gap, score });
  }
  candidates.sort((a,b) => b.score - a.score);
  const chosen = [];
  for (const c of candidates) {
    if (chosen.some(x => Math.abs(x.t - c.t) < CFG.editorialBeatMinGap)) continue;
    const dur = Math.min(Math.max(0.70, CFG.editorialBeatDuration), c.gap - 0.10);
    if (dur < 0.22) continue;
    chosen.push({
      start: Number((c.t - dur / 2).toFixed(3)),
      end: Number((c.t + dur / 2).toFixed(3)),
      duration: Number(dur.toFixed(3)),
      type: "brand_stinger",
      channel: channel.key
    });
    if (chosen.length >= Math.min(1, CFG.editorialBeatMax)) break;
  }
  return chosen.sort((a,b) => a.start - b.start);
}

function beatColors(channel) {
  if (channel.key === "social_table") {
    return { primary: "&H006AB8D6", secondary: "&H00E5F1F7", bg: "&H00353535" };
  }
  return { primary: "&H006AB3D6", secondary: "&H00FFFFFF", bg: "&H00181818" };
}

function makeEditorialBeatEvent(beat, channel) {
  // Keep editorial beat timing for diagnostics, but do not burn channel branding
  // into the middle of the footage.
  return "";
}

function speakerIndex(speaker) {
  const m = String(speaker || "").match(/(\d+)/);
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) ? n % 2 : 0;
}

function subtitleStyleName(channel, speaker) {
  return speaker ? `${channel.subtitleStyle}_S${speakerIndex(speaker)}` : channel.subtitleStyle;
}

function editorialContextLabel(clip) {
  const title = String(clip?.title || "").trim();
  const reason = String(clip?.reason || clip?.hookReason || "").toLowerCase();
  if (/payoff|reveal|punchline|answer|conclusion/.test(reason)) return "THE PAYOFF";
  if (/hook|opening|attention/.test(reason)) return "THE SETUP";
  if (/reaction|emotion|chemistry|confession/.test(reason)) return "THE MOMENT";
  if (title) return "KEY MOMENT";
  return "";
}

function makeEditorialContextEvents(words, channel, clip) {
  if (!CFG.editorialTransform.enabled || !CFG.editorialTransform.contextTag || !Array.isArray(words) || !words.length) return [];
  const label = editorialContextLabel(clip);
  if (!label) return [];
  const accent = assColorForChannel(channel);
  const start = 2.65;
  const end = Math.min(Math.max(start + 0.7, Number(words[words.length - 1]?.end || 4)), start + Number(CFG.editorialTransform.contextDuration || 1.4));
  const tag = `{\\an7\\pos(74,112)\\fad(160,220)\\fs22\\b1\\bord3\\shad2\\1c&H00FFFFFF\\3c${accent}}${assText(label)}`;
  return [`Dialogue: 18,${assTime(start)},${assTime(end)},Micro,,0,0,0,,${tag}\n`];
}

function makeAss(words, out, channel, clip, dynamicProfile = null) {
  const beats = findEditorialBeats(words, channel);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${channel.subtitleStyle},${CFG.subtitleFont},${CFG.subtitleSize},&H00FFFFFF,&H00FFFFFF,&H00141414,&H8A0B0B0B,1,0,0,0,100,100,0,0,1,2,1,2,70,70,${CFG.subtitleMarginV},1
Style: ${channel.subtitleStyle}_S0,${CFG.subtitleFont},${CFG.subtitleSize},&H00FFFFFF,&H00FFFFFF,&H00141414,&H8A0B0B0B,1,0,0,0,100,100,0,0,1,2,1,2,70,70,${CFG.subtitleMarginV},1
Style: ${channel.subtitleStyle}_S1,${CFG.subtitleFont},${CFG.subtitleSize},&H00FFFFFF,&H00FFFFFF,&H00141414,&H8A0B0B0B,1,0,0,0,100,100,0,0,1,2,1,2,70,70,${CFG.subtitleMarginV + 175},1
Style: HookBox,${CFG.subtitleFont},1,&H00FFFFFF,&H00FFFFFF,&H00141414,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: HookEditText,${CFG.hookFont || "Impact"},${CFG.hookFontSize},&H00FFFFFF,&H00FFFFFF,&H00141414,&H00000000,1,0,0,0,100,100,0,0,1,2,1,8,55,55,${CFG.hookMarginV},1
Style: HookTableText,${CFG.hookFont || "Impact"},${CFG.hookFontSize},&H00FFFFFF,&H00FFFFFF,&H00141414,&H00000000,1,0,0,0,100,100,0,0,1,2,1,8,55,55,${CFG.hookMarginV},1
Style: Micro,${CFG.subtitleFont},${CFG.microGraphics.fontSize},&H00FFFFFF,&H00FFFFFF,&H00141414,&H00000000,1,0,0,0,100,100,0,0,1,2,1,7,70,70,70,1
Style: Beat,${CFG.subtitleFont},32,&H00FFFFFF,&H00FFFFFF,&H00181818,&H00000000,1,0,0,0,100,100,0,0,1,2,0,5,70,70,70,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = makeSpeakerStreamEvents(words).map((e) => {
    const textWords = Array.isArray(e.words) && e.words.length ? e.words : words.filter(w => w.start >= e.start - 0.02 && w.start < e.end + 0.02 && w.word);
    const animation = "";
    const kinetic = makeKineticLine(textWords, e.start, clip?.emphasisWords || [], channel);
    const styleName = subtitleStyleName(channel, e.speaker);
    const positionTag = dynamicProfile ? dynamicSubtitleTag(dynamicProfile, e.start) : "";
    return `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},${styleName},,0,0,0,,${positionTag}${animation}${kinetic || assText(e.text)}\n`;
  }).join("");
  const beatEvents = beats.map(b => makeEditorialBeatEvent(b, channel)).join("");
  const hookText = hookTextForClip(clip, words, channel);
  const hookEvent = makeTopHookEvent(words, channel, clip);
  const microEventList = microGraphicEvents(words, channel, clip);
  const microEvents = microEventList.join("");
  const contextEventList = makeEditorialContextEvents(words, channel, clip);
  const contextEvents = contextEventList.join("");
  fs.writeFileSync(out, header + hookEvent + contextEvents + events + beatEvents + microEvents, "utf8");
  return { beats, hookText, microGraphics: microEventList.length, contextGraphics: contextEventList.length, hookStyle: hookStyleForText(hookText, channel), designVariation: designVariationFor(hookText, channel, clip) };
}

function watermarkEscapedText(value) {
  // Escape user-entered text for FFmpeg drawtext/filtergraph.
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 120);
}

function watermarkPosition(position, marginX, marginY, kind = "text") {
  const p = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"].includes(position)
    ? position : "bottom-right";
  if (kind === "image") {
    const x = p.endsWith("left") ? String(marginX) : p.endsWith("right") ? `W-w-${marginX}` : "(W-w)/2";
    const y = p.startsWith("top") ? String(marginY) : `H-h-${marginY}`;
    return { x, y, position: p };
  }
  const x = p.endsWith("left") ? String(marginX) : p.endsWith("right") ? `w-text_w-${marginX}` : "(w-text_w)/2";
  const y = p.startsWith("top") ? String(marginY) : `h-text_h-${marginY}`;
  return { x, y, position: p };
}

function watermarkColor(value) {
  const colors = {
    white: "0xFFFFFF", black: "0x111111", gold: "0xD6B36A",
    yellow: "0xFDE047", cyan: "0x22D3EE", pink: "0xF472B6"
  };
  return colors[String(value || "white").toLowerCase()] || colors.white;
}

async function render(video, ass, bgm, out, channel, visualVariant = "blur", clip = null, subtitleWords = [], dynamicProfile = null) {
  out = path.resolve(out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  safeDelete(out);

  const sourceInfo = await mediaInfo(video);

  const sourceWidth = Math.max(
    1,
    Number(sourceInfo.width || CFG.width)
  );

  const sourceHeight = Math.max(
    1,
    Number(sourceInfo.height || CFG.premiumVideoHeight)
  );

  // Layout is determined from the actual source dimensions.
  const aspectRatio = sourceWidth / sourceHeight;
  const layoutMode = Math.abs(aspectRatio - 1) < 0.03
    ? "SQUARE"
    : aspectRatio > 1
      ? "LANDSCAPE"
      : "PORTRAIT";

  console.log(`    [RENDER] Source: ${sourceWidth}x${sourceHeight}`);
  console.log(`    [RENDER] Aspect: ${aspectRatio.toFixed(3)}`);
  console.log(`    [RENDER] Layout: ${layoutMode}`);
  console.log(`    [RENDER] Canvas: ${CFG.width}x${CFG.height}`);

  // Smart Auto-Framing geometry: adapt foreground size to source aspect ratio.
  // Square/portrait sources target 80-85% canvas height. Landscape sources
  // use a bounded horizontal crop so the frame does not discard excessive sides.
  const requestedFgHeight = Math.max(2, Math.round((CFG.height * CFG.smartFrameHeightRatio) / 2) * 2);
  const maxLandscapeCrop = Math.max(0.15, Math.min(0.55, Number(CFG.smartFrameMaxLandscapeCrop || 0.38)));
  const maxScaledWidthForLandscape = CFG.width / (1 - maxLandscapeCrop);
  const naturalScaledWidth = sourceWidth * requestedFgHeight / sourceHeight;
  const smartScaledWidthRaw = aspectRatio > 1.03
    ? Math.min(naturalScaledWidth, maxScaledWidthForLandscape)
    : naturalScaledWidth;
  const scaledWidth = Math.max(2, Math.round(smartScaledWidthRaw / 2) * 2);
  const fgHeight = Math.max(2, Math.round((scaledWidth * sourceHeight / sourceWidth) / 2) * 2);
  const cropWidth = Math.max(2, Math.min(CFG.width, scaledWidth));
  const extraCropX = Math.max(0, scaledWidth - cropWidth);
  const focusX = Math.max(0, Math.min(1, Number(CFG.premiumVideoFocusX ?? 0.5)));
  const cropX = Math.max(0, Math.min(extraCropX, Math.round((extraCropX * focusX) / 2) * 2));

  console.log(`    [FRAMING] Smart target height: ${requestedFgHeight}px (${Math.round(CFG.smartFrameHeightRatio * 100)}% canvas)`);
  console.log(`    [FRAMING] Foreground: ${cropWidth}x${fgHeight}; scaled source width: ${scaledWidth}px`);
  if (scaledWidth > cropWidth) {
    console.log(`    [FRAMING] Horizontal crop: ${Math.round((1 - cropWidth / scaledWidth) * 100)}% total, focusX=${focusX.toFixed(2)}`);
  }

  return new Promise((resolve, reject) => {

  const a = ass.replace(/\\/g, "/").replace(/:/g, "\\:");
  const hasBgm = fs.existsSync(bgm);
  const c = ffmpeg(video);
  const campaignWM = CFG.campaignWatermark;
  const campaignWMMode = ["text", "image"].includes(campaignWM.mode) ? campaignWM.mode : "off";
  const hasCampaignWMImage = campaignWMMode === "image" && campaignWM.imagePath && fs.existsSync(campaignWM.imagePath);
  if (campaignWMMode === "image" && !hasCampaignWMImage) {
    console.log("    [WATERMARK] Image mode requested but watermark image is missing; skipped.");
  }
  if (hasCampaignWMImage) {
    c.input(campaignWM.imagePath).inputOptions(["-loop", "1", "-framerate", "30"]);
    console.log(`    [WATERMARK] IMAGE | ${path.basename(campaignWM.imagePath)} | ${campaignWM.position} | ${campaignWM.opacity.toFixed(2)} opacity`);
  } else if (campaignWMMode === "text" && campaignWM.text) {
    console.log(`    [WATERMARK] TEXT | ${campaignWM.text} | ${campaignWM.position} | ${campaignWM.opacity.toFixed(2)} opacity`);
  } else if (campaignWMMode !== "off") {
    console.log("    [WATERMARK] Skipped: no valid text/image configured.");
  } else {
    console.log("    [WATERMARK] Manual campaign watermark: OFF");
  }

  const baseVideoLabel = "vout";
  const punchWindows = makePunchZoomWindows(subtitleWords, clip, channel);
  const pacingWindows = makeEditorialPacingWindows(subtitleWords, clip, channel);
  const punchExpr = punchZoomExpression(punchWindows);
  const framingEnabled = Boolean(CFG.dynamicReframe.enabled && dynamicProfile?.samples?.length);
  const focusXExpr = framingEnabled ? dynamicFocusExpression(dynamicProfile, "x") : "0.5";
  const focusYExpr = framingEnabled ? dynamicFocusExpression(dynamicProfile, "y") : "0.5";
  const dynamicZoomExpr = dynamicPacingExpression(punchWindows, pacingWindows, channel, clip);
  console.log(`    [VISUAL] TOP HOOK: ${CFG.hookAnimation ? "ON" : "OFF"} | adaptive ${CFG.hookLargeDuration.toFixed(2)}s -> persistent pill`);
  console.log(`    [VISUAL] PUNCH ZOOM: ${CFG.punchZoom.enabled ? "ON" : "OFF"} | windows=${punchWindows.length}`);
  console.log(`    [VISUAL] EDITORIAL PACING: ${CFG.editorialTransform.enabled ? "ON" : "OFF"} | beatWindows=${pacingWindows.length}`);
  console.log(`    [VISUAL] MICRO GRAPHICS: ${CFG.microGraphics.enabled ? "ON" : "OFF"}`);
  console.log(`    [VISUAL] SMART SUBTITLE: ON | COLOR ENERGY: ${CFG.colorEnhancement.enabled ? "ON" : "OFF"}`);
  console.log(`    [FRAMING] DYNAMIC REFRAME: ${framingEnabled ? "ON | Ken Burns + face-follow" : "ON | smooth Ken Burns + center fallback"}`);

  c.on("start", cmd => console.log(`    FFmpeg: ${cmd}`));

  c.on("stderr", line => {
    if (
      line.includes("Error") ||
      line.includes("error") ||
      line.includes("Invalid") ||
      line.includes("No such")
    ) {
      console.log(`    ffmpeg: ${line}`);
    }
  });

  let filters;

  if (CFG.layout === "crop") {
    filters = [
      `[0:v]scale=-2:${CFG.height},crop=${CFG.width}:${CFG.height},ass='${a}'[${baseVideoLabel}]`
    ];
  } else {
    const isTable = channel.key === "social_table";
    const wash = isTable ? "0xF3E9D8" : "0x151515";
    const washOpacity = visualVariant === "gradient" ? 0.20 : 0.0;

    // One adaptive foreground path for landscape, square and portrait sources.
    // The blurred background fills 9:16; the foreground keeps its source aspect ratio.
    filters = [
      `[0:v]scale=${CFG.width}:${CFG.height}:force_original_aspect_ratio=increase,crop=${CFG.width}:${CFG.height},setsar=1,gblur=sigma=25[bg]`,
      framingEnabled
        ? `[0:v]scale=w='trunc(${scaledWidth}*${dynamicZoomExpr}/2)*2':h='trunc(${fgHeight}*${dynamicZoomExpr}/2)*2':eval=frame,crop=${cropWidth}:${fgHeight}:((iw-${cropWidth})*${focusXExpr}):((ih-${fgHeight})*${focusYExpr}),setsar=1[fgz]`
        : `[0:v]scale=${scaledWidth}:${fgHeight}:force_original_aspect_ratio=disable,crop=${cropWidth}:${fgHeight}:${cropX}:0,setsar=1[fgz]`,
      `[0:v]scale=${scaledWidth}:${fgHeight}:force_original_aspect_ratio=disable,crop=${cropWidth}:${fgHeight}:${cropX}:0,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto[verticalBase]`,
      `[verticalBase][fgz]overlay=(W-w)/2:(H-h)/2:format=auto:enable='${punchExpr.replace(/'/g, "\\'")}'[vertical]`
    ];
    let visualLabel = "vertical";

      // Keep footage processing focused on visible production quality, not detector evasion.

      if (CFG.colorEnhancement.enabled) {
        filters.push(
          `[${visualLabel}]eq=brightness=${CFG.colorEnhancement.brightness}:contrast=${CFG.colorEnhancement.contrast}:saturation=${CFG.colorEnhancement.saturation}:gamma=${CFG.colorEnhancement.gamma}[enhanced]`
        );
        visualLabel = "enhanced";
      }

      filters.push(`[${visualLabel}]ass='${a}'[${baseVideoLabel}]`);
      if (CFG.brandHeader) {
        const sourceFont = process.env.WATERMARK_FONT_FILE || "C:/Windows/Fonts/arial.ttf";
        const localFont = path.join(TEMP_DIR, "watermark-arial.ttf");
        try { if (fs.existsSync(sourceFont)) fs.copyFileSync(sourceFont, localFont); } catch {}
        const fontFile = fs.existsSync(localFont) ? path.relative(process.cwd(), localFont).replace(/\\/g, "/") : null;
        if (!fontFile) throw new Error(`Watermark font tidak ditemukan: ${sourceFont}`);
        const goldAlpha = visualVariant === "context" ? 0.34 : visualVariant === "gradient" ? 0.28 : 0.24;
        const gold = `0xD6B36A@${goldAlpha}`;
        filters.push(`[${baseVideoLabel}]drawbox=x=3:y=3:w=iw-6:h=ih-6:color=${gold}:t=2[bezel]`);
        filters.push(`[bezel]drawbox=x=48:y=118:w=iw-96:h=1:color=0xD6B36A@${Math.min(goldAlpha,0.30)}:t=fill[headline]`);
        filters.push(`[headline]drawbox=x=48:y=ih-119:w=iw-96:h=1:color=0xD6B36A@${Math.min(goldAlpha,0.30)}:t=fill[bezel2]`);
        filters.push(`[bezel2]null[brand]`); // Channel-name watermark intentionally removed.
      }
    }
    let videoLabel = CFG.brandHeader && CFG.layout !== "crop" ? "brand" : baseVideoLabel;

    // Optional campaign watermark is composed after the regular visual/header layers.
    // It is a presentation setting only and does not affect V3.6.31 clip selection.
    const wm = CFG.campaignWatermark;
    const wmPosition = watermarkPosition(wm.position, wm.marginX, wm.marginY, wm.mode === "image" ? "image" : "text");
    if (wm.mode === "text" && wm.text) {
      const sourceFont = process.env.WATERMARK_FONT_FILE || "C:/Windows/Fonts/arial.ttf";
      const localFont = path.join(TEMP_DIR, "watermark-arial.ttf");
      try { if (fs.existsSync(sourceFont) && !fs.existsSync(localFont)) fs.copyFileSync(sourceFont, localFont); } catch {}
      const fontFile = fs.existsSync(localFont) ? path.relative(process.cwd(), localFont).replace(/\\/g, "/") : null;
      if (!fontFile) throw new Error(`Font watermark tidak ditemukan: ${sourceFont}`);
      const text = watermarkEscapedText(wm.text);
      const color = `${watermarkColor(wm.color)}@${wm.opacity.toFixed(2)}`;
      const box = wm.box ? ":box=1:boxcolor=black@0.28:boxborderw=10" : "";
      const label = "campaignwmtext";
      filters.push(`[${videoLabel}]drawtext=text='${text}':fontfile='${fontFile}':fontcolor=${color}:fontsize=${wm.fontSize}:x=${wmPosition.x}:y=${wmPosition.y}:shadowcolor=black@0.65:shadowx=2:shadowy=2${box}[${label}]`);
      videoLabel = label;
    } else if (wm.mode === "image" && hasCampaignWMImage) {
      const sourceIndex = 1; // Input 0 is video; campaign logo is registered before optional BGM/commentary.
      filters.push(`[${sourceIndex}:v]scale=${wm.size}:-1:flags=lanczos,format=rgba,colorchannelmixer=aa=${wm.opacity.toFixed(2)}[campaignwmimg]`);
      const label = "campaignwmoverlay";
      filters.push(`[${videoLabel}][campaignwmimg]overlay=x=${wmPosition.x}:y=${wmPosition.y}:format=auto:eof_action=repeat:shortest=1[${label}]`);
      videoLabel = label;
    }

    const commentary = CFG.editorialTransform.commentaryAudio ? path.resolve(CFG.editorialTransform.commentaryAudio) : "";
    const hasCommentary = Boolean(commentary && fs.existsSync(commentary));
    
    {
      let nextInput = hasCampaignWMImage ? 2 : 1;
      const audioLabels = [];

      // Normalize dialogue on every clip, whether or not BGM/commentary is enabled.
      // This prevents later source ranges with lower loudness from sounding much quieter.
      filters.push(`[0:a]aresample=48000:async=1:first_pts=0,volume=${CFG.speakerVolume},dynaudnorm=f=150:g=15:p=0.95:m=10[a0]`);
      audioLabels.push("[a0]");

      if (hasBgm) {
        c.input(bgm);
        filters.push(`[${nextInput}:a]aresample=48000,volume=${CFG.bgmVolume}[a1]`);
        audioLabels.push("[a1]");
        nextInput += 1;
      }
      if (hasCommentary) {
        c.input(commentary);
        const delayMs = Math.max(0, Math.round(Number(CFG.editorialTransform.commentaryDelay || 0) * 1000));
        const delay = delayMs ? `adelay=${delayMs}:all=1,` : "";
        filters.push(`[${nextInput}:a]${delay}aresample=48000,volume=${CFG.editorialTransform.commentaryVolume}[ac]`);
        audioLabels.push("[ac]");
      }
      filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2,aresample=48000[aout]`);
      c.complexFilter(filters, [videoLabel, "aout"]).outputOptions(["-c:v","libx264","-crf","21","-preset","fast","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-ar","48000","-ac","2","-movflags","+faststart"]);
    }
    c.output(out)
      .on("end", () => {

        setTimeout(() => {

          if (fs.existsSync(out)) {

            const stat = fs.statSync(out);

            if (stat.size > 50000) {

              console.log(`    -> FFmpeg FINALIZED: ${stat.size} bytes`);
              resolve(out);

            } else {

              reject(new Error("Output MP4 terlalu kecil / corrupt"));

            }

          } else {

            reject(new Error("Output MP4 tidak ditemukan"));

          }

        }, 1500);

      })
      .on("error", e => {

        console.log(`    ffmpeg error detail: ${e.message}`);
        reject(e);

      })
      .run();

  });
}

function visualVariantFor(channel, index) {
  const requested = String(CFG.visualVariant || "auto").toLowerCase();
  if (["blur","gradient","context"].includes(requested)) return requested;
  if (channel.key === "social_table") return ["gradient","context","blur"][index % 3];
  return ["blur","context","gradient"][index % 3];
}

function loadTranscriptCacheOnly(base) {
  const file = path.join(CACHE_DIR, `${base}__transcript.json`);
  if (!fs.existsSync(file)) {
    console.log(`   -> Transcript cache tidak ada: ${file}; render visual-only tanpa subtitle.`);
    return { transcript: { segments: [], words: [] }, file: null };
  }
  try {
    const data = readJson(file);
    const transcript = data?.transcript || data;
    transcript.segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
    transcript.words = Array.isArray(transcript?.words) ? transcript.words : [];
    console.log(`   -> Transcript cache dipakai: ${file}`);
    console.log(`   -> transcript: ${transcript.segments.length} segments, ${transcript.words.length} words`);
    return { transcript, file };
  } catch (err) {
    console.warn(`   -> Transcript cache gagal dibaca (${err.message}); lanjut visual-only.`);
    return { transcript: { segments: [], words: [] }, file: null };
  }
}

function findSelectionReport(base, channel) {
  const prefix = `${base}__${channel.key}__selection-report-`;
  const candidates = [
    `${prefix}V3.6.43-HYBRID.json`,
    `${prefix}V3.6.43-FINAL.json`,
    `${prefix}V3.6.43.json`,
    `${prefix}V3.6.31-FINAL.json`,
    `${prefix}V3.6.31-stage6.3.json`
  ];
  for (const name of candidates) {
    const full = path.join(SELECTION_LAB_DIR, name);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  if (fs.existsSync(SELECTION_LAB_DIR)) {
    const matches = fs.readdirSync(SELECTION_LAB_DIR)
      .filter(name => name.startsWith(prefix) && name.toLowerCase().endsWith('.json'))
      .map(name => {
        const full = path.join(SELECTION_LAB_DIR, name);
        let stat;
        try { stat = fs.statSync(full); } catch { return null; }
        return stat.isFile() ? { full, mtime: stat.mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
    if (matches.length) return matches[0].full;
  }
  return null;
}

function loadFinalSelection(base, channel, videoDuration) {
  const report = findSelectionReport(base, channel);
  if (!report) {
    throw new Error(
      `Selection report tidak ditemukan untuk ${base} / ${channel.key}. ` +
      `Periksa folder ${SELECTION_LAB_DIR} dan pastikan selection engine selesai tanpa error.`
    );
  }

  let data;
  try {
    data = readJson(report);
  } catch (err) {
    throw new Error(`Selection report tidak bisa dibaca (${report}): ${err.message}`);
  }

  const source = Array.isArray(data?.distinctRecommendations)
    ? data.distinctRecommendations
    : [];
  const clips = [];
  const seen = new Set();

  for (const c of source) {
    if (!c || typeof c !== 'object') continue;
    const nonlinear = Array.isArray(c.nonlinearRanges) && c.nonlinearRanges.length
      ? c.nonlinearRanges
      : null;
    const knownRanges = Array.isArray(c.ranges) && c.ranges.length ? c.ranges : null;
    const start = Number(c.start ?? knownRanges?.[0]?.start ?? nonlinear?.[0]?.start);
    const end = Number(c.end ?? knownRanges?.[0]?.end ?? nonlinear?.[0]?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    let activeRanges = nonlinear
      ? nonlinear.map(r => ({ start: Number(r?.start), end: Number(r?.end) }))
      : [{ start, end }];
    if (!activeRanges.length || activeRanges.some(r =>
      !Number.isFinite(r.start) || !Number.isFinite(r.end) ||
      r.start < 0 || r.end <= r.start || r.end > videoDuration + 0.25
    )) continue;

    const key = activeRanges.map(r => `${r.start.toFixed(3)}-${r.end.toFixed(3)}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const title = String(c.title || c.name || 'Untitled Clip').trim() || 'Untitled Clip';
    const totalDuration = activeRanges.reduce((sum, r) => sum + r.end - r.start, 0);
    clips.push({
      ...c,
      title,
      fileTitle: c.fileTitle || title,
      reason: String(c.reason || c.judge?.primaryReason || c.editorialValue?.reasons?.join(', ') || 'Selection brain recommendation'),
      ranges: activeRanges,
      duration: totalDuration,
      totalDuration,
      sourceSelection: data.version || path.basename(report).match(/selection-report-(.+)\.json/i)?.[1] || 'selection-report',
      selectionReport: report
    });
  }

  if (!clips.length) {
    throw new Error(`Selection report tidak memiliki distinctRecommendations/range valid: ${report}`);
  }

  // Renderer only renders the ordered recommendations; it never re-ranks or caps them.
  console.log(`   -> Selection report: ${report}`);
  console.log(`   -> Selection brain version: ${data.version || path.basename(report)}`);
  console.log(`   -> Recommendations: ${clips.length} (urutan dan jumlah dari selection brain; tidak dipilih ulang)`);
  clips.forEach((c, i) => {
    if (c.ranges.length > 1) {
      console.log(`      [CLIP ${i + 1}] MICRO-CUT (${c.ranges.length} bagian; ${c.totalDuration.toFixed(2)}s) | ${c.title}`);
    } else {
      const r = c.ranges[0];
      console.log(`      [CLIP ${i + 1}] ${r.start.toFixed(2)}-${r.end.toFixed(2)} | ${c.title}`);
    }
  });
  return { report, clips, version: data.version || path.basename(report) };
}

async function processVideo(fileName) {
  const input = path.join(INPUT_DIR, fileName);
  const base = path.basename(fileName, path.extname(fileName));

  try {
    const sourceStat = fs.statSync(input);
    if (!sourceStat.isFile() || sourceStat.size <= 0) {
      throw new Error(`File sumber kosong/0 byte: ${input}. Salin ulang video asli yang masih utuh ke folder input.`);
    }
    console.log(`[BOOT] Renderer PID=${process.pid} | Node=${process.execPath}`);
    console.log(`[BOOT] Project root (cwd)=${process.cwd()}`);
    console.log(`[BOOT] Source=${input} | bytes=${sourceStat.size}`);
    console.log(`\n====================================================`);
    console.log(` V3.6.43 HYBRID — BOTH CHANNELS — RENDERER ONLY — ${fileName}`);
    console.log(`====================================================`);

    const info = await mediaInfo(input);
    console.log(`Source: ${info.width}x${info.height} | ${clock(info.duration)}`);
    if (!info.hasAudio) console.warn("Source tidak memiliki audio; render tetap dilanjutkan tanpa audio sumber.");

    console.log(`Selection brain: report-driven (version detected from selection report)`);
    console.log(`Renderer brain: OFF`);
    console.log(`Smart Square: ON`);
    console.log(`WhisperX subtitle alignment: ${CFG.whisperxEnabled ? "ON" : "OFF"}`);

    const { transcript, file: transcriptCache } = loadTranscriptCacheOnly(base);
    const channels = resolveChannels(CFG.channelMode);

    for (const channel of channels) {
      console.log(`\n====================================================`);
      console.log(` RENDER PASS: ${channel.label}`);
      console.log(`====================================================`);

      let selection;
      try {
        selection = loadFinalSelection(base, channel, info.duration);
      } catch (err) {
        console.warn(`   -> Channel ${channel.key} dilewati: ${err.message}`);
        continue;
      }
      const clips = selection.clips;

      console.log(`   -> ${channel.label}: ${clips.length} clip dari selection report`);

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const r = clip.ranges[0];
        console.log(`\n[RENDER ${i + 1}/${clips.length}] ${channel.label} — ${clip.title}`);
        console.log(`    ${clock(r.start)} -> ${clock(r.end)} (${(r.end-r.start).toFixed(2)}s)`);
        console.log(`    Selection source: ${selection.version || path.basename(selection.report)}`);
        console.log(`    Editorial decision: NOT RE-EVALUATED`);

        let parts = [];
        let stitched = null;
        try {
          const stem = `${base}__${channel.shortName}__${String(i+1).padStart(2,"0")}`;
          const renderResult = await renderRanges(input, clip.ranges, path.join(TEMP_DIR, stem));
          parts = renderResult.parts;
          stitched = renderResult.stitched;

          const ass = path.join(TEMP_DIR, `${stem}.ass`);
          let subtitleWords = finalWords(clip, transcript);
          const clipDuration = Math.max(0.1, Number(clip.totalDuration || clip.duration || (clip.ranges || []).reduce((n, x) => n + Math.max(0, Number(x.end) - Number(x.start)), 0)));
          if (subtitleWords.length) {
            subtitleWords = await alignWordsToRenderedClip(stitched, subtitleWords, stem, clipDuration);
          } else {
            console.log("    [SUBTITLE] OFF — tidak ada word timestamp; hook visual tetap aktif.");
          }

          const visualVariant = visualVariantFor(channel, i);
          const dynamicProfile = await runDynamicReframe(stitched);
          if (dynamicProfile) {
            console.log(`    [FRAMING] Object-aware face tracking: ON | samples=${dynamicProfile.samples.length}`);
          } else {
            console.log(`    [FRAMING] Object-aware tracking: FALLBACK CENTER`);
          }
          const assVisuals = makeAss(subtitleWords, ass, channel, clip, dynamicProfile);

          const ep = episodeCode(base);
          const outName = `${channel.shortName}__${ep}__CLIP_${String(i+1).padStart(2,"0")}__${safeFileTitle(clip.title)}.mp4`;
          const out = path.resolve(OUTPUT_DIR, outName);

          console.log("[RENDER] 9:16 output...");
          console.log(`    Output: ${out}`);
          await render(stitched, ass, path.join(ASSETS_DIR, "bgm.mp3"), out, channel, visualVariant, clip, subtitleWords, dynamicProfile);

          const manifest = out.replace(/\.mp4$/i, ".json");
          writeJson(manifest, {
            version: "V3.6.43-HYBRID-RENDERER",
            channel: channel.key,
            channelLabel: channel.label,
            source: fileName,
            title: clip.title,
            fileTitle: clip.fileTitle || safeFileTitle(clip.title),
            hookScore: Number(clip.hookScore || 0),
            storyScore: Number(clip.storyScore || 0),
            payoffScore: Number(clip.payoffScore || 0),
            hookReason: clip.hookReason || "",
            emphasisWords: clip.emphasisWords || [],
            loopIntent: clip.loopIntent || "",
            outputFile: path.basename(out),
            reason: clip.reason,
            sourceRanges: clip.ranges,
            totalDuration: clip.totalDuration,
            layout: CFG.layout,
            visualVariant,
            editorialBeats: assVisuals.beats,
            topHook: assVisuals.hookText,
            microGraphics: assVisuals.microGraphics,
            contextGraphics: assVisuals.contextGraphics || 0,
            editorialPacing: CFG.editorialTransform.enabled,
            commentaryLayer: Boolean(CFG.editorialTransform.commentaryAudio && fs.existsSync(path.resolve(CFG.editorialTransform.commentaryAudio))),
            hookStyle: assVisuals.hookStyle,
            designVariation: assVisuals.designVariation,
            dynamicReframe: Boolean(dynamicProfile),
            objectAwareTracking: Boolean(dynamicProfile),
            subtitleSafeZones: Boolean(dynamicProfile),
            visualSystems: { topHook: CFG.hookAnimation, topHookMode: "persistent-adaptive", hookBrandInsideCard: false, smartSubtitle: true, punchZoom: CFG.punchZoom.enabled, microGraphics: CFG.microGraphics.enabled, colorEnergy: CFG.colorEnhancement.enabled, designVariation: true, dynamicReframe: true, objectAwareTracking: true, subtitleSafeZones: true },
            campaignWatermark: { mode: CFG.campaignWatermark.mode, ...(CFG.campaignWatermark.mode === "text" ? { text: CFG.campaignWatermark.text } : {}), ...(CFG.campaignWatermark.mode === "image" ? { image: path.basename(CFG.campaignWatermark.imagePath || "") } : {}), position: CFG.campaignWatermark.position, size: CFG.campaignWatermark.size, opacity: CFG.campaignWatermark.opacity },
            transcriptCache,
            selectionSource: clip.sourceSelection || selection.version || "V3.6.43-HYBRID",
            selectionReport: selection.report,
            renderer: "V3.6.43-HYBRID-RENDERER",
            smartSquare: true,
            subtitleSource: subtitleWords.length ? "transcript-cache" : "disabled-no-speech",
            whisperXAlignment: CFG.whisperxEnabled
          });

          console.log(`   ✓ DONE: ${out}`);
          [...parts, stitched, ass].forEach(safeDelete);
        } catch (e) {
          console.error(`   [!] ${channel.label} clip gagal: ${e.message}`);
          [...parts, stitched].filter(Boolean).forEach(safeDelete);
        }
      }
    }

    console.log("\nDONE - V3.6.43 HYBRID RENDERER ONLY. Selection sepenuhnya dari selection brain; renderer tidak memilih ulang.");
  } finally {
    fs.readdirSync(TEMP_DIR)
      .filter(f => f.startsWith(`${base}__audio_`))
      .forEach(f => safeDelete(path.join(TEMP_DIR, f)));
  }
}

process.on("exit", () => {
  try { if (whisperXWorkerProcess) whisperXWorkerProcess.kill(); } catch {}
});

async function main(){
  ensureDirs();
  console.log(`[BOOT] Renderer entry started | PID=${process.pid} | Node=${process.execPath}`);
  console.log(`[BOOT] cwd=${process.cwd()}`);
  console.log(`[BOOT] inputDir=${path.resolve(INPUT_DIR)} | outputDir=${path.resolve(OUTPUT_DIR)}`);

  const videoNames = fs.readdirSync(INPUT_DIR)
    .filter(f => /\.(mp4|mov|mkv|m4v)$/i.test(f));
  if (!videoNames.length) {
    throw new Error(`Folder ${path.resolve(INPUT_DIR)} tidak berisi video yang didukung (mp4, mov, mkv, m4v).`);
  }

  const validFiles = [];
  for (const name of videoNames) {
    const full = path.join(INPUT_DIR, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isFile() && stat.size > 0) validFiles.push(name);
    else console.warn(`[INPUT SKIP] ${name} kosong/0 byte; dilewati.`);
  }
  if (!validFiles.length) {
    throw new Error(`Semua video di ${path.resolve(INPUT_DIR)} kosong atau 0 byte. Pulihkan/copy ulang file asli sebelum render.`);
  }

  // The web server passes the chosen source as argv[2]. Prefer it over arbitrary filesystem order.
  const requested = path.basename(String(process.argv[2] || process.env.SELECTION_SELECTED_FILE || '')).trim();
  let chosen;
  if (requested) {
    chosen = validFiles.find(name => name === requested);
    if (!chosen) {
      throw new Error(`Source yang diminta server tidak tersedia/valid di input/: ${requested}. Valid: ${validFiles.join(', ')}`);
    }
  } else {
    chosen = validFiles[0];
    if (validFiles.length > 1) {
      console.warn(`[INPUT] Ditemukan ${validFiles.length} video valid; manual run memakai file pertama: ${chosen}`);
    }
  }
  console.log(`[BOOT] Selected source=${chosen}`);
  await processVideo(chosen);
}

main().catch(e=>{ console.error("\n[!] FATAL:",e); process.exitCode=1; });

