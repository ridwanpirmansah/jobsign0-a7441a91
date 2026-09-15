// Service-role Supabase client with resilient env resolution.
// Server-only: never import this from client-reachable module scope.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "./supabase-env";

let cached: ReturnType<typeof createClient<Database>> | undefined;

export function getAdminClient() {
  if (!cached) {
    cached = createClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
