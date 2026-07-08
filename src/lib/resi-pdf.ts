import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

export function generateResiNumber(prefix = "FE"): string {
  // Format: FE + yymmdd + 6-digit random
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rnd = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}${yy}${mm}${dd}${rnd}`;
}

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    displayValue: false,
    margin: 0,
    height: 60,
    width: 2,
  });
  return canvas.toDataURL("image/png");
}

export interface ResiPayload {
  no_resi: string;
  ekspedisi?: string | null;
  co_date?: string | null;
  kota?: string | null;
  text_neon?: string | null;
  username?: string | null;
  order_no?: string | null;
}

export function printResiPdf(payload: ResiPayload) {
  // Ukuran label thermal 100mm x 100mm
  const doc = new jsPDF({ unit: "mm", format: [100, 100], orientation: "portrait" });
  const W = 100;
  const H = 100;
  const pad = 5;

  // Header teks (tanpa background biar hemat tinta)
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("FUJI ELECTRIC", pad, 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("NEON SIGN WORKSHOP", W - pad, 8, { align: "right" });

  // Pembatas tebal antara header dan nama ekspedisi
  doc.setLineWidth(0.8);
  doc.line(pad, 11, W - pad, 11);

  // Ekspedisi + tanggal
  let y = 17;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const eks = (payload.ekspedisi || "REGULER").toUpperCase();
  doc.text(eks, pad, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const tgl = payload.co_date
    ? new Date(payload.co_date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
    : "-";
  doc.text(`Tgl: ${tgl}`, W - pad, y, { align: "right" });

  // Barcode area (kasih napas atas & bawah)
  y += 5;
  doc.setLineWidth(0.2);
  doc.line(pad, y, W - pad, y);
  y += 4;
  try {
    const img = barcodeDataUrl(payload.no_resi);
    doc.addImage(img, "PNG", pad + 3, y, W - (pad + 3) * 2, 14);
  } catch {
    /* ignore */
  }
  y += 17;
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text(payload.no_resi, W / 2, y, { align: "center" });
  y += 3;
  doc.setLineWidth(0.2);
  doc.line(pad, y, W - pad, y);

  // PENGIRIM
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("PENGIRIM", pad, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Fuji Electric", pad, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("0877-7980-3435", W - pad, y, { align: "right" });
  y += 4;
  doc.setFontSize(8);
  doc.text("Tasikmalaya", pad, y);

  y += 3;
  doc.setLineWidth(0.2);
  doc.line(pad, y, W - pad, y);

  // PENERIMA
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("PENERIMA", pad, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(payload.username || "-", pad, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const kota = doc.splitTextToSize(payload.kota || "-", W - pad * 2);
  doc.text(kota, pad, y);
  y += kota.length * 4 + 2;

  // Detail produk (kalau masih muat)
  if (y < H - 14) {
    doc.setLineWidth(0.2);
    doc.line(pad, y, W - pad, y);
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("DETAIL", pad, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const maxLines = Math.max(1, Math.floor((H - 8 - y) / 3.8));
    const teks = doc.splitTextToSize(`Neon: ${payload.text_neon || "-"}`, W - pad * 2).slice(0, maxLines);
    doc.text(teks, pad, y);
    y += teks.length * 3.8;
    if (payload.order_no && y < H - 6) {
      doc.setFontSize(7);
      doc.text(`No. Order: ${payload.order_no}`, pad, y);
    }
  }

  // Footer note
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6);
  doc.text("Fragile — Handle with care · Neon sign akrilik", W / 2, H - 2, { align: "center" });

  doc.save(`resi-${payload.no_resi}.pdf`);
}
