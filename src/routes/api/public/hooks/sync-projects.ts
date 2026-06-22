import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/sync-projects")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Auth: anon/publishable key in apikey header (matches Lovable cron pattern)
        const provided = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const { runProjectSync } = await import("@/lib/sheet-sync.server");
          const result = await runProjectSync();
          return Response.json(result);
        } catch (e: any) {
          console.error("sync-projects hook error", e);
          return new Response(
            JSON.stringify({ ok: false, error: e?.message ?? "unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
