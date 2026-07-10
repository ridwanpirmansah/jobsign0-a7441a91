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
  kind: z.enum(["custom", "ready_stock_ref", "ready_stock_manual", "draft_ref"]),
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
  source_draft_order_id: z.string().uuid().nullable().optional(),
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

export const listDraftAvailable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orders")
      .select("id, order_no, text_neon, hpp, payment, titik, username, kota")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });


// ============ Shipment / Pickup ============

export const markReadyPickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      order_id: z.string().uuid(),
      no_resi: z.string().trim().min(1).optional(),
      ekspedisi: z.string().trim().optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    if (data.no_resi) {
      const patch: { no_resi: string; ekspedisi?: string | null } = { no_resi: data.no_resi };
      if (data.ekspedisi !== undefined) patch.ekspedisi = data.ekspedisi || null;
      const { error: upErr } = await context.supabase
        .from("orders").update(patch).eq("id", data.order_id);
      if (upErr) throw new Error(upErr.message);
    }
    const { error } = await context.supabase.rpc("mark_ready_pickup", { _order_id: data.order_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const courierPickup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ no_resi: z.string().min(1), note: z.string().optional().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("courier_pickup", {
      _no_resi: data.no_resi,
      _note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return res as { order_id: string; order_no: string; ekspedisi: string | null };
  });

export const markReadyPickupByResi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ no_resi: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("mark_ready_pickup_by_resi", {
      _no_resi: data.no_resi.trim(),
    });
    if (error) throw new Error(error.message);
    return res as { order_id: string; order_no: string; ekspedisi: string | null; no_resi: string };
  });

// ============ Shipping Carriers (master ekspedisi) ============

export const listCarriers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("shipping_carriers")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const carrierSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export const upsertCarrier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => carrierSchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { id, ...payload } = data;
    if (id) {
      const { error } = await context.supabase.from("shipping_carriers").update(payload).eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true, id };
    }
    const { data: ins, error } = await context.supabase
      .from("shipping_carriers").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { ok: true, id: ins.id };
  });

export const deleteCarrier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { error } = await context.supabase.from("shipping_carriers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPickupReady = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orders")
      .select("id, order_no, no_resi, ekspedisi, username, kota, text_neon, ready_pickup_at, picked_up_at, picked_up_by, co_date")
      .not("ready_pickup_at", "is", null)
      .is("picked_up_at", null)
      .order("ready_pickup_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMyPickups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("orders")
      .select("id, order_no, no_resi, ekspedisi, username, kota, text_neon, ready_pickup_at, picked_up_at")
      .eq("picked_up_by", context.userId)
      .order("picked_up_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

