import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

function fmtIDR(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
}

export type SlipJobBreakdown = { name: string; unit: string; qty: number; amount: number };
export type SlipAttendance = { date: string; check_in: string | null; check_out: string | null; hours: number };
export type SlipConsumption = {
  date: string;
  note: string | null;
  amount: number;
  companyCovered?: number;
  employeeCharge?: number;
  paymentMethod?: "cash" | "cashbon";
};

export interface SlipData {
  employeeName: string;
  employeeCode?: string | null;
  employeeType?: string | null;
  periodStart: string; // yyyy-MM-dd (Sunday)
  periodEnd: string;   // yyyy-MM-dd (Saturday)
  jobBreakdown: SlipJobBreakdown[];
  repairBreakdown?: SlipJobBreakdown[];
  attendance: SlipAttendance[];
  consumption?: SlipConsumption[];
  base: number;
  bonus: number;
  cashbonDeduction: number;
  consumptionDeduction?: number;
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

  // Rincian Reparasi (opsional)
  const repairs = d.repairBreakdown ?? [];
  if (repairs.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Rincian Pekerjaan Reparasi", margin, y);
    y += 4;
    autoTable(doc, {
      startY: y + 4,
      head: [["Jenis Reparasi", "Satuan", "Jumlah", "Upah"]],
      body: repairs.map((b) => [b.name, b.unit, b.qty.toString(), fmtIDR(b.amount)]),
      foot: [[
        "Subtotal Reparasi",
        "",
        repairs.reduce((s, b) => s + b.qty, 0).toString(),
        fmtIDR(repairs.reduce((s, b) => s + b.amount, 0)),
      ]],
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [234, 88, 12], textColor: 255 },
      footStyles: { fillColor: [255, 237, 213], textColor: 15, fontStyle: "bold" },
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
      margin: { left: margin, right: margin },
    });
    // @ts-expect-error autotable injects lastAutoTable
    y = doc.lastAutoTable.finalY + 16;
  }

  // Rincian Konsumsi (Pengurang) — opsional
  const consumption = d.consumption ?? [];
  if (consumption.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Rincian Konsumsi (Pengurang Upah)", margin, y);
    y += 4;
    autoTable(doc, {
      startY: y + 4,
      head: [["Tanggal", "Catatan", "Metode", "Nominal", "Ditanggung Perusahaan", "Tagihan Karyawan"]],
      body: consumption.map((c) => [
        format(new Date(c.date), "EEE, dd MMM", { locale: idLocale }),
        c.note ?? "—",
        (c.paymentMethod ?? "cashbon") === "cash" ? "Cash" : "Cashbon",
        fmtIDR(c.amount),
        fmtIDR(c.companyCovered ?? 0),
        fmtIDR(c.employeeCharge ?? 0),
      ]),
      foot: [[
        "Subtotal",
        "",
        "",
        fmtIDR(consumption.reduce((s, c) => s + c.amount, 0)),
        fmtIDR(consumption.reduce((s, c) => s + (c.companyCovered ?? 0), 0)),
        fmtIDR(consumption.reduce((s, c) => s + (c.employeeCharge ?? 0), 0)),
      ]],
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255 },
      footStyles: { fillColor: [254, 226, 226], textColor: 15, fontStyle: "bold" },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
      margin: { left: margin, right: margin },
    });
    // @ts-expect-error autotable injects lastAutoTable
    y = doc.lastAutoTable.finalY + 6;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text("Tagihan karyawan dari konsumsi cashbon sudah otomatis masuk ke Potongan Cashbon di ringkasan.", margin, y);
    doc.setTextColor(0);
    y += 12;
  }


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
  const consumptionDed = d.consumptionDeduction ?? 0;
  const totalDed = d.cashbonDeduction + consumptionDed + other;
  const net = d.base + d.bonus - totalDed;

  autoTable(doc, {
    startY: y + 4,
    body: [
      ["Penghasilan Pokok (Base)", fmtIDR(d.base)],
      ["Bonus", fmtIDR(d.bonus)],
      ["Potongan Cashbon", `- ${fmtIDR(d.cashbonDeduction)}`],
      ...(consumptionDed > 0 ? [["Potongan Konsumsi", `- ${fmtIDR(consumptionDed)}`]] : []),
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
