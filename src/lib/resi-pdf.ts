import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

export function generateResiNumber(prefix = "LS"): string {
  // Format: LS + yymmdd + 6-digit random  (mirip pattern SPX)
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
  // Ukuran SPX label: 100mm x 150mm (portrait)
  const doc = new jsPDF({ unit: "mm", format: [100, 150], orientation: "portrait" });
  const W = 100;
  const pad = 5;

  // Header brand bar
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, W, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("LINTANG SEMESTA", pad, 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("NEON SIGN WORKSHOP", W - pad, 9, { align: "right" });

  // Ekspedisi + tanggal row
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  let y = 19;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const eks = (payload.ekspedisi || "REGULER").toUpperCase();
  doc.text(eks, pad, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const tgl = payload.co_date ? new Date(payload.co_date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";
  doc.text(`Tgl: ${tgl}`, W - pad, y, { align: "right" });
  y += 2;
  doc.setLineWidth(0.3);
  doc.line(pad, y, W - pad, y);

  // Barcode
  y += 3;
  try {
    const img = barcodeDataUrl(payload.no_resi);
    doc.addImage(img, "PNG", pad, y, W - pad * 2, 20);
  } catch {
    /* ignore */
  }
  y += 22;
  doc.setFont("courier", "bold");
  doc.setFontSize(13);
  doc.text(payload.no_resi, W / 2, y, { align: "center" });
  y += 4;
  doc.setLineWidth(0.3);
  doc.line(pad, y, W - pad, y);

  // FROM / TO
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("PENGIRIM", pad, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Lintang Semesta Workshop", pad, y);
  y += 4;
  doc.setFontSize(8);
  doc.text("Yogyakarta", pad, y);

  y += 5;
  doc.setLineWidth(0.2);
  doc.setDrawColor(150, 150, 150);
  doc.line(pad, y, W - pad, y);
  doc.setDrawColor(0, 0, 0);

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("PENERIMA", pad, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(payload.username || "-", pad, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const kota = doc.splitTextToSize(payload.kota || "-", W - pad * 2);
  doc.text(kota, pad, y);
  y += kota.length * 4.5 + 2;

  // Divider
  doc.setLineWidth(0.3);
  doc.line(pad, y, W - pad, y);
  y += 4;

  // Detail produk
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("DETAIL PRODUK", pad, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const teks = doc.splitTextToSize(`Neon: ${payload.text_neon || "-"}`, W - pad * 2);
  doc.text(teks, pad, y);
  y += teks.length * 4.5;
  if (payload.order_no) {
    doc.setFontSize(8);
    doc.text(`No. Order: ${payload.order_no}`, pad, y);
    y += 4;
  }

  // Footer
  const footY = 145;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(pad, footY - 4, W - pad, footY - 4);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.text("Fragile — Handle with care · Neon sign akrilik", W / 2, footY, { align: "center" });

  doc.save(`resi-${payload.no_resi}.pdf`);
}
