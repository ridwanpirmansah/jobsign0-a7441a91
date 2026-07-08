// Audio + haptic feedback for scanner interactions.

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

function tone(freq: number, durationMs: number, opts: { type?: OscillatorType; gain?: number; delayMs?: number } = {}) {
  const ctx = getCtx();
  if (!ctx) return;
  const start = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
  const end = start + durationMs / 1000;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(freq, start);
  const peak = opts.gain ?? 0.18;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch { /* ignore */ }
}

/** Sharp short "tiit" like courier scanners (JNT/SPX style). */
export function beepSuccess() {
  tone(2600, 120, { type: "square", gain: 0.22 });
  vibrate(40);
}

/** Low double-buzz + vibrate for failed scans. */
export function beepError() {
  tone(220, 180, { type: "sawtooth", gain: 0.25 });
  tone(180, 220, { type: "sawtooth", gain: 0.25, delayMs: 200 });
  vibrate([80, 60, 160]);
}

/** Speak Indonesian phrase via Web Speech API. Falls back silently. */
export function speakId(text: string) {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "id-ID";
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const id = voices.find((v) => v.lang?.toLowerCase().startsWith("id"));
    if (id) u.voice = id;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

/** Preload voices (some browsers load them async). */
export function primeSpeech() {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
    getCtx();
  } catch { /* ignore */ }
}
