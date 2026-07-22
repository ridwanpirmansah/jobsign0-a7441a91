// Audio + haptic feedback for scanner interactions.
// Cached AudioBuffers + cached SpeechSynthesisUtterances to eliminate delay
// on the second and subsequent scans.

let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

// ---------- Cached tone buffers ----------

type BeepSpec = { freq: number; durationMs: number; type: OscillatorType; gain: number; delayMs?: number };

const beepBufferCache = new Map<string, AudioBuffer>();

function renderBeepBuffer(ctx: AudioContext, key: string, specs: BeepSpec[]): AudioBuffer {
  const cached = beepBufferCache.get(key);
  if (cached) return cached;
  const sr = ctx.sampleRate;
  const totalMs = Math.max(...specs.map((s) => (s.delayMs ?? 0) + s.durationMs));
  const length = Math.ceil((totalMs / 1000) * sr) + 32;
  const buf = ctx.createBuffer(1, length, sr);
  const data = buf.getChannelData(0);
  for (const s of specs) {
    const startSample = Math.floor(((s.delayMs ?? 0) / 1000) * sr);
    const endSample = Math.min(length, startSample + Math.floor((s.durationMs / 1000) * sr));
    const attack = Math.floor(sr * 0.008);
    const release = Math.floor(sr * 0.01);
    for (let i = startSample; i < endSample; i++) {
      const t = (i - startSample) / sr;
      const phase = 2 * Math.PI * s.freq * t;
      let sample: number;
      switch (s.type) {
        case "sine": sample = Math.sin(phase); break;
        case "sawtooth": sample = 2 * ((s.freq * t) % 1) - 1; break;
        case "triangle": sample = 2 * Math.abs(2 * ((s.freq * t) % 1) - 1) - 1; break;
        default: sample = Math.sign(Math.sin(phase)); break; // square
      }
      // simple attack/release envelope
      const rel = endSample - i;
      let env = s.gain;
      if (i - startSample < attack) env *= (i - startSample) / attack;
      else if (rel < release) env *= rel / release;
      data[i] += sample * env;
    }
  }
  // normalize soft-clip
  for (let i = 0; i < length; i++) data[i] = Math.tanh(data[i]);
  beepBufferCache.set(key, buf);
  return buf;
}

function playBuffer(buf: AudioBuffer) {
  const ctx = getCtx();
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 1.0;
  src.connect(g).connect(ctx.destination);
  src.start();
}

const SUCCESS_SPEC: BeepSpec[] = [
  { freq: 2700, durationMs: 160, type: "square", gain: 0.95 },
  { freq: 2700, durationMs: 160, type: "sine", gain: 0.6 },
  { freq: 5400, durationMs: 160, type: "square", gain: 0.35 },
];
const ERROR_SPEC: BeepSpec[] = [
  { freq: 240, durationMs: 220, type: "sawtooth", gain: 0.9 },
  { freq: 240, durationMs: 220, type: "square", gain: 0.5 },
  { freq: 180, durationMs: 260, type: "sawtooth", gain: 0.9, delayMs: 240 },
];

/** Loud, sharp "tiit" — cached AudioBuffer, plays instantly. */
export function beepSuccess() {
  const ctx = getCtx();
  if (ctx) playBuffer(renderBeepBuffer(ctx, "success", SUCCESS_SPEC));
  vibrate(60);
}

/** Loud double-buzz + vibrate for failed scans. */
export function beepError() {
  const ctx = getCtx();
  if (ctx) playBuffer(renderBeepBuffer(ctx, "error", ERROR_SPEC));
  vibrate([100, 60, 200]);
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch { /* ignore */ }
}

// ---------- Cached speech ----------

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesLoaded = false;
const utteranceCache = new Map<string, SpeechSynthesisUtterance>();

function loadVoices() {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      voicesLoaded = true;
      cachedVoice =
        voices.find((v) => v.lang?.toLowerCase().startsWith("id")) ??
        voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ??
        voices[0] ?? null;
      // rebuild cached utterances with the new voice
      utteranceCache.clear();
    }
  } catch { /* ignore */ }
}

function getUtterance(text: string): SpeechSynthesisUtterance | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  let u = utteranceCache.get(text);
  if (!u) {
    u = new SpeechSynthesisUtterance(text);
    u.lang = "id-ID";
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    if (cachedVoice) u.voice = cachedVoice;
    utteranceCache.set(text, u);
  }
  return u;
}

/** Speak Indonesian phrase via Web Speech API. Uses cached utterance for speed. */
export function speakId(text: string) {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!voicesLoaded) loadVoices();
    const u = getUtterance(text);
    if (!u) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/** Preload voices, warm up TTS engine, and pre-render beep buffers. */
export function primeSpeech() {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      loadVoices();
      if (!voicesLoaded) {
        // Some browsers load voices async — listen once.
        window.speechSynthesis.addEventListener("voiceschanged", loadVoices, { once: true });
      }
      // Silent warm-up utterance to boot the TTS engine (iOS/Android).
      try {
        const warm = new SpeechSynthesisUtterance(" ");
        warm.volume = 0;
        warm.rate = 1;
        window.speechSynthesis.speak(warm);
      } catch { /* ignore */ }
    }
    const ctx = getCtx();
    if (ctx) {
      // Pre-render beep buffers so first scan has zero decode latency.
      renderBeepBuffer(ctx, "success", SUCCESS_SPEC);
      renderBeepBuffer(ctx, "error", ERROR_SPEC);
    }
  } catch { /* ignore */ }
}
