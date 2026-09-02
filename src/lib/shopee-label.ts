import { getShopeeLabel } from "@/lib/shopee.functions";

/** Ambil PDF resi Shopee sebagai object URL (blob). */
export async function fetchShopeeLabelUrl(orderId: string): Promise<string> {
  const res: any = await getShopeeLabel({ data: { order_id: orderId } });
  if (!res?.ok || !res.pdf) throw new Error(res?.error ?? "Gagal mengambil resi Shopee");
  const bin = atob(res.pdf);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export async function openShopeeLabel(orderId: string): Promise<void> {
  const url = await fetchShopeeLabelUrl(orderId);
  window.open(url, "_blank", "noopener");
}
