import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireStaff(ctx: any) {
  const { data } = await ctx.supabase.rpc("is_admin_or_owner", { _user_id: ctx.userId });
  if (!data) throw new Error("Forbidden: hanya admin/owner");
}

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orders")
      .select("*, order_items!order_items_order_id_fkey(id, position, kind, text_neon, manual_name, titik, item_hpp, manual_price, source_ready_stock_order_id)")
      .order("co_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listPrices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("material_prices")
      .select("*")
      .order("key");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const orderSchema = z.object({
  id: z.string().uuid().optional(),
  source: z.enum(["shopee", "tiktok", "tokopedia", "lazada", "direct", "lainnya"]),
  status: z.enum(["active", "return", "draft", "ready_stock"]).default("active"),
  order_no: z.string().default(""),
  co_date: z.string().nullable().optional(),
  username: z.string().optional().nullable(),
  kota: z.string().optional().nullable(),
  text_neon: z.string().default(""),
  akrilik_p: z.number().min(0).default(0),
  akrilik_l: z.number().min(0).default(0),
  led_meter: z.number().min(0).default(0),
  titik: z.number().int().min(0).default(0),
  kabel_meter: z.number().min(0).default(0),
  kabel_socket_meter: z.number().min(0).default(1),
  payment: z.number().min(0).default(0),
  dp: z.number().min(0).default(0),
  split: z.number().min(0).default(0),
  adaptor: z.number().min(0).default(0),
  adaptor_type: z.string().optional().nullable(),
  modul: z.number().min(0).default(0),
  socket_dc: z.number().min(0).default(0),
  baut_fischer: z.number().min(0).default(0),
  outdoor_cost: z.number().min(0).nullable().optional(),
  notes: z.string().optional().nullable(),
  no_resi: z.string().optional().nullable(),
  ekspedisi: z.string().optional().nullable(),
});

export const upsertOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => orderSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { id, ...payload } = data;
    const row = { ...payload, created_by: context.userId };
    if (id) {
      const { error } = await context.supabase.from("orders").update(row).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    } else {
      const { data: ins, error } = await context.supabase.from("orders").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      return { ok: true, id: ins.id };
    }
  });

export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { error } = await context.supabase.from("orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updatePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: z.string().min(1), value: z.number().min(0) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isOwner } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "owner",
    });
    if (!isOwner) throw new Error("Forbidden: hanya owner");
    const { error } = await context.supabase
      .from("material_prices")
      .update({ value: data.value, updated_at: new Date().toISOString() })
      .eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Order Items ============

export const listOrderItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("order_items")
      .select("*")
      .eq("order_id", data.orderId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  order_id: z.string().uuid(),
  position: z.number().int().min(1),
  kind: z.enum(["custom", "ready_stock_ref", "ready_stock_manual"]),
  text_neon: z.string().nullable().optional(),
  akrilik_p: z.number().min(0).default(0),
  akrilik_l: z.number().min(0).default(0),
  led_meter: z.number().min(0).default(0),
  titik: z.number().int().min(0).default(0),
  kabel_meter: z.number().min(0).nullable().optional(),
  kabel_socket_meter: z.number().min(0).default(1),
  adaptor: z.number().min(0).default(0),
  adaptor_type: z.string().nullable().optional(),
  modul: z.number().min(0).default(0),
  socket_dc: z.number().min(0).default(0),
  baut_fischer: z.number().min(0).default(0),
  outdoor_cost: z.number().min(0).nullable().optional(),
  source_ready_stock_order_id: z.string().uuid().nullable().optional(),
  manual_name: z.string().nullable().optional(),
  manual_price: z.number().min(0).default(0),
  manual_hpp: z.number().min(0).default(0),
  notes: z.string().nullable().optional(),
});

export const upsertOrderItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => itemSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { id, ...payload } = data;
    if (id) {
      const { error } = await context.supabase.from("order_items").update(payload).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    } else {
      const { data: ins, error } = await context.supabase.from("order_items").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      return { ok: true, id: ins.id };
    }
  });

export const deleteOrderItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { error } = await context.supabase.from("order_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listReadyStockAvailable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orders")
      .select("id, order_no, text_neon, hpp, payment, titik")
      .eq("status", "ready_stock")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
