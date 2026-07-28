import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/sync-shopee")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          const { runShopeeSync } = await import("@/lib/shopee.server");
          return Response.json(await runShopeeSync(false));
        } catch (e: any) {
          console.error("sync-shopee hook error", e);
          return new Response(
            JSON.stringify({ ok: false, error: e?.message ?? "unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
