// Compute the rotating attendance token client-side from the shared secret.
// Token = first 10 hex chars of HMAC-SHA256(secret, window) where window = floor(epoch_seconds / 6)
// Must match public.attendance_check_in() in the database.

export const WINDOW_SECONDS = 10;

export function currentWindow(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / WINDOW_SECONDS);
}

export function secondsLeftInWindow(nowMs = Date.now()): number {
  const next = (currentWindow(nowMs) + 1) * WINDOW_SECONDS * 1000;
  return Math.max(0, Math.ceil((next - nowMs) / 1000));
}

export async function computeToken(secret: string, window: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(window)));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 10);
}
