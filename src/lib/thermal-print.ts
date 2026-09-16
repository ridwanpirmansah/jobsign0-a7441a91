/**
 * Cetak langsung ke printer termal Bluetooth (ESC/POS) via Web Bluetooth.
 * Hanya didukung Chrome/Edge Android + printer BLE.
 */
import { generateBarcodeDataUrl, type ResiPayload } from "@/lib/resi-pdf";

// ---------- Pengaturan printer (per perangkat, localStorage) ----------

export type PrinterSettings = {
  /** lebar kertas dalam mm (58, 80, atau custom) */
  widthMm: number;
  /** kepekatan cetak: 1 terang, 2 normal, 3 gelap */
  density: 1 | 2 | 3;
};

const SETTINGS_KEY = "printer-settings-v1";

export function getPrinterSettings(): PrinterSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const widthMm = Math.round(Number(p?.widthMm));
      const density = [1, 2, 3].includes(p?.density) ? (p.density as 1 | 2 | 3) : 2;
      if (widthMm >= 30 && widthMm <= 120) return { widthMm, density };
    }
  } catch {
    /* fallback ke default */
  }
  return { widthMm: 58, density: 2 };
}

export function savePrinterSettings(s: PrinterSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** lebar kertas terpilih dlm mm; null kalau custom */
export const PAPER_PRESETS = [
  { label: "58 mm", widthMm: 58 },
  { label: "80 mm", widthMm: 80 },
];

// ---------- Koneksi Bluetooth ----------

const BLE_SERVICES = [
  0xff00, 0x18f0, 0xff02, 0xae00, 0xfee7, 0xe781, 0xfee9,
].map((s) => `0000${s.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`);

type PrinterConn = {
  device: any;
  characteristic: any;
  disconnect: () => void;
};

let lastDevice: any = null;

export function isThermalPrintSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

async function openDevice(device: any): Promise<PrinterConn> {
  const server = await device.gatt.connect();
  let characteristic: any = null;

  const services = await server.getPrimaryServices().catch(() => []);
  for (const svc of services) {
    const chars = await svc.getCharacteristics().catch(() => []);
    for (const c of chars) {
      const p = c.properties ?? {};
      if (p.write || p.writeWithoutResponse) {
        characteristic = c;
        break;
      }
    }
    if (characteristic) break;
  }
  if (!characteristic) {
    try { server.disconnect(); } catch { /* noop */ }
    throw new Error("Tidak menemukan karakteristik cetak pada printer ini");
  }
  return {
    device,
    characteristic,
    disconnect: () => {
      try { server.disconnect(); } catch { /* noop */ }
    },
  };
}

async function connectPrinter(): Promise<PrinterConn> {
  const bt = (navigator as any).bluetooth;
  if (!bt) {
    throw new Error(
      "Bluetooth cetak hanya didukung Chrome/Edge di Android. Gunakan tombol Download sebagai alternatif."
    );
  }

  // Coba ulang perangkat yang sudah pernah dipasangkan di sesi ini.
  if (lastDevice) {
    try {
      const conn = await openDevice(lastDevice);
      return conn;
    } catch {
      lastDevice = null;
    }
  }
  // Coba izin Bluetooth yang tersimpan dari sesi sebelumnya.
  if (typeof bt.getDevices === "function") {
    try {
      const devs = await bt.getDevices();
      for (const d of devs ?? []) {
        try {
          const conn = await openDevice(d);
          lastDevice = d;
          return conn;
        } catch {
          /* lanjut ke perangkat berikutnya */
        }
      }
    } catch {
      /* getDevices tidak tersedia / izin belum ada */
    }
  }

  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_SERVICES,
  });
  device.addEventListener?.("gattserverdisconnected", () => {
    if (lastDevice === device) lastDevice = null;
  });
  const conn = await openDevice(device);
  lastDevice = device;
  return conn;
}

async function sendChunks(characteristic: any, bytes: Uint8Array) {
  const useNoResponse = !!characteristic.properties?.writeWithoutResponse;
  const write = useNoResponse && typeof characteristic.writeValueWithoutResponse === "function"
    ? (b: Uint8Array) => characteristic.writeValueWithoutResponse(b)
    : (b: Uint8Array) => characteristic.writeValue(b);
  const chunkSize = 180; // aman untuk sebagian besar MTU BLE
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
    await write(chunk);
    await new Promise((r) => setTimeout(r, 18));
  }
}

// ---------- Kanvas -> ESC/POS raster ----------

/** Floyd–Steinberg dithering lalu bangun perintah gambar `GS v 0`. */
function canvasToRasterCommand(canvas: HTMLCanvasElement, density: 1 | 2 | 3): Uint8Array {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  // kepekatan: makin gelap -> threshold makin rendah (lebih banyak piksel hitam)
  const threshold = density === 1 ? 170 : density === 2 ? 135 : 100;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const isBlack = old < threshold;
      out[i] = isBlack ? 1 : 0;
      const err = old - (isBlack ? 0 : 255);
      const push = (dx: number, dy: number, f: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) return;
        gray[ny * w + nx] += err * f;
      };
      push(1, 0, 7 / 16);
      push(-1, 1, 3 / 16);
      push(0, 1, 5 / 16);
      push(1, 1, 1 / 16);
    }
  }

  // ESC @ init + GS v 0 raster
  const rowBytes = Math.ceil(w / 8);
  const head = new Uint8Array([
    0x1b, 0x40, // ESC @ — reset
    0x1d, 0x76, 0x30, 0x00, // GS v 0 m=0 (normal)
    rowBytes & 0xff, (rowBytes >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ]);
  const data = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (out[y * w + x]) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const feed = new Uint8Array([0x0a, 0x0a, 0x0a]); // feed agar tidak terpotong
  const result = new Uint8Array(head.length + data.length + feed.length);
  result.set(head, 0);
  result.set(data, head.length);
  result.set(feed, head.length + data.length);
  return result;
}

async function printCanvas(canvas: HTMLCanvasElement) {
  const s = getPrinterSettings();
  const payload = canvasToRasterCommand(canvas, s.density);
  const conn = await connectPrinter();
  try {
    await sendChunks(conn.characteristic, payload);
  } finally {
    // tahan koneksi sebentar; biarkan perangkat terputus sendiri agar reusable
    setTimeout(() => conn.disconnect(), 400);
  }
}

// ---------- Renderer resi (meniru tata letak PDF 100x100mm) ----------

function pxForWidth(widthMm: number): number {
  // 8 dot per mm (printer 203dpi standar)
  return Math.round(widthMm * 8);
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function renderResiCanvas(payload: ResiPayload, pxWidth: number): HTMLCanvasElement {
  // kanvas persegi mengikuti label 100x100mm
  const W = pxWidth;
  const H = pxWidth;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "alphabetic";

  const pad = W * 0.05;
  const scale = W / 384; // rasio terhadap basis 58mm agar proporsi tetap

  const font = (weight: string, px: number, family = "Arial") => {
    ctx.font = `${weight} ${px}px ${family}`;
  };

  // header
  font("bold", Math.round(13 * 2.6 * scale));
  ctx.textAlign = "left";
  ctx.fillText("FUJI ELECTRIC", pad, W * 0.075);
  font("normal", Math.round(7 * 2.6 * scale));
  ctx.textAlign = "right";
  ctx.fillText("NEON SIGN WORKSHOP", W - pad, W * 0.075);

  ctx.lineWidth = Math.max(1, 0.8 * 3 * scale);
  line(ctx, pad, W * 0.105, W - pad, W * 0.105);

  // ekspedisi + tanggal
  font("bold", Math.round(13 * 2.6 * scale));
  ctx.textAlign = "left";
  ctx.fillText((payload.ekspedisi || "REGULER").toUpperCase(), pad, W * 0.165);
  font("normal", Math.round(8 * 2.6 * scale));
  ctx.textAlign = "right";
  const tgl = payload.co_date
    ? new Date(payload.co_date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
    : "-";
  ctx.fillText(`Tgl: ${tgl}`, W - pad, W * 0.165);

  // barcode
  let y = W * 0.205;
  ctx.lineWidth = 1;
  line(ctx, pad, y, W - pad, y);
  y += W * 0.03;
  try {
    const img = new Image();
    img.src = generateBarcodeDataUrl(payload.no_resi);
    // gambar sinkron dari canvas dataURL tersedia setelah decode; pakai draw langsung
    ctx.drawImage(img, pad + W * 0.03, y, W - (pad + W * 0.03) * 2, W * 0.135);
  } catch {
    /* abaikan bila barcode gagal */
  }
  y += W * 0.165;
  font("bold", Math.round(11 * 2.6 * scale), "Courier New");
  ctx.textAlign = "center";
  ctx.fillText(payload.no_resi, W / 2, y);
  y += W * 0.03;
  line(ctx, pad, y, W - pad, y);

  // PENGIRIM
  y += W * 0.05;
  font("bold", Math.round(7 * 2.6 * scale));
  ctx.textAlign = "left";
  ctx.fillText("PENGIRIM", pad, y);
  y += W * 0.04;
  font("bold", Math.round(9 * 2.6 * scale));
  ctx.fillText("Fuji Electric", pad);
  ctx.textAlign = "right";
  font("normal", Math.round(8 * 2.6 * scale));
  ctx.fillText("0877-7980-3435", W - pad, y);
  y += W * 0.04;
  ctx.textAlign = "left";
  ctx.fillText("Tasikmalaya", pad, y);

  y += W * 0.03;
  line(ctx, pad, y, W - pad, y);

  // PENERIMA
  y += W * 0.05;
  font("bold", Math.round(7 * 2.6 * scale));
  ctx.fillText("PENERIMA", pad, y);
  y += W * 0.04;
  font("bold", Math.round(10 * 2.6 * scale));
  ctx.fillText(payload.username || "-", pad, y);
  if (payload.phone) {
    ctx.textAlign = "right";
    font("normal", Math.round(8 * 2.6 * scale));
    ctx.fillText(payload.phone, W - pad, y);
    ctx.textAlign = "left";
  }
  y += W * 0.04;
  font("normal", Math.round(9 * 2.6 * scale));
  const kotaLines = splitLines(ctx, payload.kota || "-", W - pad * 2);
  kotaLines.forEach((l) => {
    ctx.fillText(l, pad, y);
    y += W * 0.04;
  });

  y += W * 0.02;
  if (y < H - W * 0.12) {
    line(ctx, pad, y, W - pad, y);
    y += W * 0.04;
    font("bold", Math.round(7 * 2.6 * scale));
    ctx.fillText("DETAIL", pad, y);
    y += W * 0.04;
    font("normal", Math.round(8 * 2.6 * scale));
    const maxLines = Math.max(1, Math.floor((H - W * 0.06 - y) / (W * 0.038)));
    const teks = splitLines(ctx, `Neon: ${payload.text_neon || "-"}`, W - pad * 2).slice(0, maxLines);
    teks.forEach((l) => {
      ctx.fillText(l, pad, y);
      y += W * 0.038;
    });
    if (payload.order_no && y < H - W * 0.05) {
      font("normal", Math.round(7 * 2.6 * scale));
      ctx.fillText(`No. Order: ${payload.order_no}`, pad, y);
    }
  }

  font("italic", Math.round(6 * 2.6 * scale));
  ctx.textAlign = "center";
  ctx.fillText("Fragile — Handle with care", W / 2, H - W * 0.02);

  return canvas;
}

function splitLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !cur) cur = test;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : ["-"];
}

// ---------- PDF Shopee -> kanvas ----------

let pdfjsMod: any = null;
async function getPdfjs() {
  if (!pdfjsMod) {
    pdfjsMod = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjsMod.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return pdfjsMod;
}

async function renderPdfUrlToCanvas(url: string, targetWidthPx: number): Promise<HTMLCanvasElement> {
  const pdfjs = await getPdfjs();
  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal memuat PDF resi");
  const data = await res.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidthPx / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
  return canvas;
}

// ---------- API publik ----------

/** Cetak resi manual aplikasi ke printer termal. */
export async function printResiThermal(payload: ResiPayload): Promise<void> {
  const s = getPrinterSettings();
  const canvas = renderResiCanvas(payload, pxForWidth(s.widthMm));
  await printCanvas(canvas);
}

/** Cetak label Shopee (PDF tersimpan) ke printer termal. */
export async function printShopeeLabelThermal(orderId: string): Promise<void> {
  const { fetchShopeeLabelUrl } = await import("@/lib/shopee-label");
  const url = await fetchShopeeLabelUrl(orderId);
  try {
    const s = getPrinterSettings();
    const canvas = await renderPdfUrlToCanvas(url, pxForWidth(s.widthMm));
    await printCanvas(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Cetak PDF dari object URL apa pun (mis. preview Shopee). */
export async function printPdfUrlThermal(url: string): Promise<void> {
  const s = getPrinterSettings();
  const canvas = await renderPdfUrlToCanvas(url, pxForWidth(s.widthMm));
  await printCanvas(canvas);
}

/** Halaman tes cetak. */
export async function printTestThermal(): Promise<void> {
  const s = getPrinterSettings();
  const W = pxForWidth(s.widthMm);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = Math.round(W * 0.5);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.font = `bold ${Math.round(W * 0.09)}px Arial`;
  ctx.fillText("TES CETAK", W / 2, canvas.height * 0.3);
  ctx.font = `${Math.round(W * 0.055)}px Arial`;
  ctx.fillText(`Kertas: ${s.widthMm}mm`, W / 2, canvas.height * 0.5);
  ctx.fillText(`Kepekatan: ${["", "Terang", "Normal", "Gelap"][s.density]}`, W / 2, canvas.height * 0.65);
  ctx.fillText(new Date().toLocaleString("id-ID"), W / 2, canvas.height * 0.8);
  await printCanvas(canvas);
}
