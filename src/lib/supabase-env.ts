// Resolves Supabase connection settings on the server with safe fallbacks.
// On self-hosted deployments (e.g. Vercel) only the VITE_* variables may be
// configured; those are public values, so falling back to them is safe.
function pick(...values: Array<string | undefined>) {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

const viteEnv: Record<string, string | undefined> =
  (typeof import.meta !== "undefined" && (import.meta as any).env) || {};

export function getSupabaseUrl(): string {
  const url = pick(
    process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
    viteEnv.VITE_SUPABASE_URL,
  );
  if (!url) {
    throw new Error(
      "Alamat database belum diatur. Isi SUPABASE_URL (atau VITE_SUPABASE_URL) pada pengaturan environment server, lalu deploy ulang.",
    );
  }
  return url;
}

export function getSupabasePublishableKey(): string {
  const key = pick(
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
    viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
    viteEnv.VITE_SUPABASE_ANON_KEY,
  );
  if (!key) {
    throw new Error(
      "Kunci publik database belum diatur. Isi SUPABASE_PUBLISHABLE_KEY (atau VITE_SUPABASE_PUBLISHABLE_KEY) pada pengaturan environment server, lalu deploy ulang.",
    );
  }
  return key;
}

export function getSupabaseServiceRoleKey(): string {
  const key = pick(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) {
    throw new Error(
      "Kunci rahasia database (SUPABASE_SERVICE_ROLE_KEY) belum diatur pada environment server. Tambahkan lalu deploy ulang.",
    );
  }
  return key;
}
