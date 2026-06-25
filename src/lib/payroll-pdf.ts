import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

export type SlipJobBreakdown = { name: string; unit: string; qty: number; amount: number };
export type SlipAttendance = { date: string; check_in: string | null; check_out: string | null; hours: number };

export interface SlipData {
  employeeName: string;
  employeeCode?: string | null;
  employeeType?: string | null;
  periodStart: string; // yyyy-MM-dd (Sunday)
  periodEnd: string;   // yyyy-MM-dd (Saturday)
  jobBreakdown: SlipJobBreakdown[];
  attendance: SlipAttendance[];
  base: number;
  bonus: number;
  cashbonDeduction: number;
  otherDeduction?: number;
  totalHours: number;
}

export function generateSlipPdf(d: SlipData) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("SLIP GAJI MINGGUAN", pageW / 2, y, { align: "center" });
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Workshop — Periode Mingguan (Minggu – Sabtu)", pageW / 2, y, { align: "center" });
  y += 20;

  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 14;

  // Employee + period info
  doc.setFontSize(10);
  const periodStr = `${format(new Date(d.periodStart), "EEEE, dd MMM yyyy", { locale: idLocale })} – ${format(new Date(d.periodEnd), "EEEE, dd MMM yyyy", { locale: idLocale })}`;
  const rows: [string, string][] = [
    ["Nama Karyawan", d.employeeName],
    ["Kode / Tipe", `${d.employeeCode ?? "-"}${d.employeeType ? ` · ${d.employeeType}` : ""}`],
    ["Periode", periodStr],
    ["Tanggal Cetak", format(new Date(), "dd MMM yyyy HH:mm", { locale: idLocale })],
  ];
  rows.forEach(([k, v]) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`: ${v}`, margin + 110, y);
    y += 14;
  });

  y += 6;

  // Rincian Garapan
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Rincian Garapan (Borongan)", margin, y);
  y += 4;

  autoTable(doc, {
    startY: y + 4,
    head: [["Jenis Garapan", "Satuan", "Jumlah", "Upah"]],
    body: d.jobBreakdown.length
      ? d.jobBreakdown.map((b) => [b.name, b.unit, b.qty.toString(), fmtIDR(b.amount)])
      : [["—", "—", "—", "—"]],
    foot: [[
      "Subtotal Borongan",
      "",
      d.jobBreakdown.reduce((s, b) => s + b.qty, 0).toString(),
      fmtIDR(d.jobBreakdown.reduce((s, b) => s + b.amount, 0)),
    ]],
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    footStyles: { fillColor: [241, 245, 249], textColor: 15, fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error autotable injects lastAutoTable
  y = doc.lastAutoTable.finalY + 16;

  // Rincian Kehadiran / Jam Kerja
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Rincian Jam Kerja (per Hari)", margin, y);

  autoTable(doc, {
    startY: y + 4,
    head: [["Tanggal", "Check-in", "Check-out", "Jam Kerja"]],
    body: d.attendance.length
      ? d.attendance.map((a) => [
          format(new Date(a.date), "EEE, dd MMM", { locale: idLocale }),
          a.check_in ? format(new Date(a.check_in), "HH:mm") : "—",
          a.check_out ? format(new Date(a.check_out), "HH:mm") : "—",
          a.hours > 0 ? `${a.hours.toFixed(2)} jam` : "—",
        ])
      : [["—", "—", "—", "—"]],
    foot: [["Total Jam Kerja", "", "", `${d.totalHours.toFixed(2)} jam`]],
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [16, 185, 129], textColor: 255 },
    footStyles: { fillColor: [241, 245, 249], textColor: 15, fontStyle: "bold" },
    columnStyles: { 3: { halign: "right" } },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error autotable injects lastAutoTable
  y = doc.lastAutoTable.finalY + 16;

  // Ringkasan Gaji
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Ringkasan Gaji", margin, y);

  const other = d.otherDeduction ?? 0;
  const totalDed = d.cashbonDeduction + other;
  const net = d.base + d.bonus - totalDed;

  autoTable(doc, {
    startY: y + 4,
    body: [
      ["Penghasilan Pokok (Base)", fmtIDR(d.base)],
      ["Bonus", fmtIDR(d.bonus)],
      ["Potongan Cashbon", `- ${fmtIDR(d.cashbonDeduction)}`],
      ...(other > 0 ? [["Potongan Lain", `- ${fmtIDR(other)}`]] : []),
      [{ content: "TOTAL DITERIMA", styles: { fontStyle: "bold", fillColor: [16, 185, 129], textColor: 255 } },
       { content: fmtIDR(net), styles: { fontStyle: "bold", halign: "right", fillColor: [16, 185, 129], textColor: 255 } }],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    columnStyles: { 0: { cellWidth: 260 }, 1: { halign: "right" } },
    margin: { left: margin, right: margin },
    theme: "grid",
  });

  // @ts-expect-error autotable injects lastAutoTable
  y = doc.lastAutoTable.finalY + 30;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Slip ini dicetak otomatis dari sistem. Simpan untuk arsip pribadi.", pageW / 2, y, { align: "center" });

  const safeName = d.employeeName.replace(/[^a-zA-Z0-9]+/g, "_");
  doc.save(`SlipGaji_${safeName}_${d.periodStart}_${d.periodEnd}.pdf`);
}
