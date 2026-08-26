import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdminOrOwner(context: any) {
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const list = (roles ?? []) as any[];
  const ok = list.some((r) => r.role === "admin" || r.role === "owner");
  if (!ok) throw new Error("Forbidden: hanya admin/owner");
  return list.some((r) => r.role === "owner");
}

export const getShopeeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminOrOwner(context);
    const { loadSettings } = await import("./shopee.server");
    const s = await loadSettings();
    return {
      partner_id: s.partner_id ?? "",
      has_partner_key: !!s.partner_key,
      redirect_url: s.redirect_url ?? "",
      shop_id: s.shop_id,
      connected: !!s.shop_id && !!s.refresh_token,
      connected_at: s.connected_at,
      enabled: s.enabled,
      lookback_days: s.lookback_days ?? 7,
      last_sync_at: (s as any).last_sync_at ?? null,
      last_sync_status: (s as any).last_sync_status ?? null,
      last_sync_message: (s as any).last_sync_message ?? null,
      last_sync_inserted: (s as any).last_sync_inserted ?? 0,
      last_sync_updated: (s as any).last_sync_updated ?? 0,
      last_sync_skipped: (s as any).last_sync_skipped ?? 0,
    };
  });

const credsSchema = z.object({
  partner_id: z.string().trim().min(1).max(64).regex(/^\d+$/, "Partner ID harus angka"),
  partner_key: z.string().trim().max(256).optional(),
  lookback_days: z.number().int().min(1).max(90).default(7),
  enabled: z.boolean().default(false),
});

export const saveShopeeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => credsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const isOwner = await requireAdminOrOwner(context);
    if (!isOwner) throw new Error("Forbidden: hanya owner");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      partner_id: data.partner_id,
      lookback_days: data.lookback_days,
      enabled: data.enabled,
    };
    if (data.partner_key && data.partner_key.length > 0) patch.partner_key = data.partner_key;
    const { error } = await supabaseAdmin
      .from("shopee_settings")
      .update(patch as any)
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getShopeeAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ origin: z.string().url().max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const isOwner = await requireAdminOrOwner(context);
    if (!isOwner) throw new Error("Forbidden: hanya owner");
    const { buildAuthUrl } = await import("./shopee.server");
    try {
      return { ok: true as const, url: await buildAuthUrl(data.origin), error: null as string | null };
    } catch (e: any) {
      return { ok: false as const, url: null, error: String(e?.message ?? e) };
    }
  });

export const previewShopeeOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ days: z.number().int().min(1).max(90) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdminOrOwner(context);
    const { previewOrders } = await import("./shopee.server");
    try {
      return { ok: true as const, rows: await previewOrders(data.days), error: null as string | null };
    } catch (e: any) {
      return { ok: false as const, rows: [], error: String(e?.message ?? e) };
    }
  });

export const importShopeeOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ order_sns: z.array(z.string().trim().min(1).max(64)).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdminOrOwner(context);
    const { importSelected } = await import("./shopee.server");
    try {
      return await importSelected(data.order_sns);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      return { ok: false, inserted: 0, updated: 0, skipped: 0, errors: [msg], message: msg };
    }
  });

export const syncShopeeNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdminOrOwner(context);
    const { runShopeeSync } = await import("./shopee.server");
    try {
      return await runShopeeSync(true);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      return { ok: false, inserted: 0, updated: 0, skipped: 0, errors: [msg], message: msg };
    }
  });

export const disconnectShopee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isOwner = await requireAdminOrOwner(context);
    if (!isOwner) throw new Error("Forbidden: hanya owner");
    const { disconnectShop } = await import("./shopee.server");
    await disconnectShop();
    return { ok: true };
  });
