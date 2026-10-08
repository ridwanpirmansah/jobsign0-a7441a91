import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAuth } from "@/lib/app-auth";
import { formatOrderPrintLabel } from "@/lib/thermal-layout";

export const getOrderPrintLabel = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .inputValidator((data: unknown) => z.object({ orderId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase.from("orders")
      .select("text_neon,akrilik_p,akrilik_l,order_items!order_items_order_id_fkey(text_neon,manual_name,akrilik_p,akrilik_l,position,source_ready_stock_order_id,source_draft_order_id)")
      .eq("id", data.orderId).single();
    if (error) throw new Error(error.message);
    const items = [...(order.order_items ?? [])].sort((a, b) => a.position - b.position);
    const sourceIds = items.flatMap((item) => [item.source_ready_stock_order_id, item.source_draft_order_id]).filter((id): id is string => Boolean(id));
    const sources = new Map<string, { text_neon: string; akrilik_p: number; akrilik_l: number }>();
    if (sourceIds.length) {
      const { data: rows, error: sourceError } = await context.supabase.from("orders")
        .select("id,text_neon,akrilik_p,akrilik_l").in("id", sourceIds);
      if (sourceError) throw new Error(sourceError.message);
      for (const row of rows ?? []) sources.set(row.id, row);
    }
    return formatOrderPrintLabel(items.length ? items.map((item) => {
      const sourceId = item.source_ready_stock_order_id || item.source_draft_order_id;
      const source = sourceId ? sources.get(sourceId) : undefined;
      return {
        text_neon: item.text_neon || item.manual_name || source?.text_neon,
        akrilik_p: item.akrilik_p || source?.akrilik_p,
        akrilik_l: item.akrilik_l || source?.akrilik_l,
      };
    }) : [order]);
  });