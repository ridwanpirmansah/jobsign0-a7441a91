// Auth middleware with resilient env resolution (works on Lovable Cloud and
// on self-hosted deployments where only VITE_* variables are configured).
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getSupabasePublishableKey, getSupabaseUrl } from "./supabase-env";

export const requireAppAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const url = getSupabaseUrl();
    const publishableKey = getSupabasePublishableKey();

    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: sesi login tidak ditemukan");
    }
    const token = authHeader.replace("Bearer ", "");
    if (!token) throw new Error("Unauthorized: sesi login tidak ditemukan");

    const supabase = createClient<Database>(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      throw new Error("Unauthorized: sesi login tidak valid");
    }

    return next({
      context: { supabase, userId: data.claims.sub as string, claims: data.claims },
    });
  },
);
