/** Physical ESC/POS resolution, independent of the configured printable width. */
export const THERMAL_DOTS_PER_MM = 8;

export type OrderLabelPart = {
  text_neon?: string | null;
  manual_name?: string | null;
  akrilik_p?: number | null;
  akrilik_l?: number | null;
};

export function formatOrderPrintLabel(parts: OrderLabelPart[]): string {
  return parts.map((part) => {
    const name = (part.text_neon || part.manual_name || "").trim();
    if (!name) return "";
    const size = Number(part.akrilik_p) > 0 && Number(part.akrilik_l) > 0
      ? `${Number(part.akrilik_p)}x${Number(part.akrilik_l)}` : "";
    return size && !name.replace(/\s/g, "").includes(size) ? `${name} ${size}` : name;
  }).filter(Boolean).join(" / ");
}

export function thermalPageLayout(width: number, receiptHeight: number, footerHeight: number, heightMm: number) {
  const naturalHeight = receiptHeight + footerHeight;
  const height = heightMm > 0 ? Math.round(heightMm * THERMAL_DOTS_PER_MM) : naturalHeight;
  const scale = Math.min(1, height / naturalHeight);
  return { height, scale, receiptWidth: width * scale, receiptHeight: receiptHeight * scale, footerHeight: footerHeight * scale };
}

export function thermalTrailingFeed(heightMm: number): Uint8Array {
  return heightMm > 0 ? new Uint8Array() : new Uint8Array([0x0a, 0x0a, 0x0a]);
}