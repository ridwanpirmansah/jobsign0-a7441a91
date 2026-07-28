import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/shopee/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code") ?? "";
        const shopId = url.searchParams.get("shop_id") ?? "";
        const back = `${url.origin}/owner/shopee`;

        if (!code || !/^\d+$/.test(shopId)) {
          return Response.redirect(`${back}?shopee=error&msg=${encodeURIComponent("Callback tidak lengkap dari Shopee")}`, 302);
        }
        try {
          const { exchangeCode } = await import("@/lib/shopee.server");
          await exchangeCode(code, shopId);
          return Response.redirect(`${back}?shopee=connected`, 302);
        } catch (e: any) {
          const msg = String(e?.message ?? e).slice(0, 200);
          console.error("shopee callback error", e);
          return Response.redirect(`${back}?shopee=error&msg=${encodeURIComponent(msg)}`, 302);
        }
      },
    },
  },
});
