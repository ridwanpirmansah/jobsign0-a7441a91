import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

// Project-specific bearer attacher. Tries getSession first, then refreshSession
// as a fallback to avoid transient "No authorization header" errors when the
// stored access token is expired but a refresh token is still available.
export const attachSupabaseBearer = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    let token: string | undefined;
    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
      if (!token) {
        const r = await supabase.auth.refreshSession();
        token = r.data.session?.access_token;
      }
    } catch {
      // ignore; request will proceed without header and server will reject
    }
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
