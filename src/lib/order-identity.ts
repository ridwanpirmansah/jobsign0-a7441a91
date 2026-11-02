export type ShopeeMappedOrder = {
  id: string;
  order_no: string;
  status: string;
  consumed_at: string | null;
};

// Stock consumption does not transfer the original Shopee sale to the buyer of that stock.
export function resolveShopeeImportTarget(order: ShopeeMappedOrder | null | undefined) {
  if (!order || order.consumed_at || !["active", "return"].includes(order.status)) return null;
  if (/^(RS|DR)-/i.test(order.order_no)) return null;
  return order;
}

export function matchesOrderSearch(order: {
  order_no?: unknown; username?: unknown; kota?: unknown; text_neon?: unknown; no_resi?: unknown;
}, query: string) {
  const q = query.trim().toLowerCase();
  return !q || [order.order_no, order.username, order.kota, order.text_neon, order.no_resi]
    .some((value) => String(value ?? "").toLowerCase().includes(q));
}