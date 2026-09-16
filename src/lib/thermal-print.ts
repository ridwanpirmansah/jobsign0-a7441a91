/**
 * Cetak langsung ke printer termal Bluetooth (ESC/POS) via Web Bluetooth.
 * Hanya didukung Chrome/Edge Android + printer BLE.
 */
import { generateBarcodeDataUrl, type ResiPayload } from "@/lib/resi-pdf";
import {
  DEFAULT_PRINTER_SETTINGS,
  getPrinterSettings as getSharedPrinterSettings,
  type PrinterSettings,
} from "@/lib/printer-settings.functions";

// ---------- Pengaturan printer (per perangkat, localStorage) ----------

export type { PrinterSettings } from "@/lib/printer-settings.functions";

let cachedSettings: PrinterSettings = DEFAULT_PRINTER_SETTINGS;

export function setPrinterSettingsCache(settings: PrinterSettings) {
  cachedSettings = settings;
}

export async function loadPrinterSettings(): Promise<PrinterSettings> {
  try {
    cachedSettings = await getSharedPrinterSettings();
  } catch {
    // Cetak tetap tersedia dengan ukuran aman jika koneksi setelan terputus.
  }
  return cachedSettings;
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

async function printCanvas(canvas: HTMLCanvasElement, density: 1 | 2 | 3) {
  const payload = canvasToRasterCommand(canvas, density);
  const conn = await connectPrinter();
  try {
    await sendChunks(conn.characteristic, payload);
  } finally {
    // tahan koneksi sebentar; biarkan perangkat terputus sendiri agar reusable
    setTimeout(() => conn.disconnect(), 400);
  }
}

// ---------- Renderer resi (meniru tata letak PDF 100x100mm) ----------

/** Lebar total titik printer (manual bila diisi). */
function paperPx(settings: PrinterSettings): number {
  if (settings.paperDots) return Math.max(128, Math.min(1024, settings.paperDots));
  if (settings.widthMm === 58) return settings.dots58;
  if (settings.widthMm === 80) return settings.dots80;
  return Math.max(256, Math.min(640, Math.round(settings.widthMm * 7.2)));
}

/** Lebar area cetak isi (manual bila diisi). */
function contentPx(settings: PrinterSettings): number {
  const paper = paperPx(settings);
  const content = settings.contentDots ? settings.contentDots : paper - settings.insetDots * 2;
  return Math.max(128, Math.min(paper, content));
}

/** Tempatkan kanvas isi ke kanvas selebar kertas sesuai perataan. */
function placeOnPaper(content: HTMLCanvasElement, settings: PrinterSettings): HTMLCanvasElement {
  const paper = paperPx(settings);
  if (content.width === paper) return content;
  const canvas = document.createElement("canvas");
  canvas.width = paper;
  canvas.height = content.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kanvas cetak tidak tersedia");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gap = paper - content.width;
  const x = settings.align === "left" ? 0 : settings.align === "right" ? gap : Math.round(gap / 2);
  ctx.drawImage(content, x, 0);
  return canvas;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

async function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  if (typeof image.decode === "function") await image.decode();
  else await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Barcode gagal dimuat"));
  });
  return image;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number, weight = "normal") {
  let size = startPx;
  do {
    ctx.font = `${weight} ${size}px Arial`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  } while (size > 9);
  return size;
}

async function renderResiCanvas(payload: ResiPayload, pxWidth: number, insetDots: number): Promise<HTMLCanvasElement> {
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

  const pad = Math.max(insetDots, Math.round(W * 0.035));
  const scale = W / 384;

  const font = (weight: string, px: number, family = "Arial") => {
    ctx.font = `${weight} ${px}px ${family}`;
  };

  // header
  font("bold", Math.round(19 * scale));
  ctx.textAlign = "left";
  ctx.fillText("FUJI ELECTRIC", pad, W * 0.075);
  font("normal", Math.round(10 * scale));
  ctx.textAlign = "right";
  ctx.fillText("NEON SIGN WORKSHOP", W - pad, W * 0.075);

  ctx.lineWidth = Math.max(1, 0.8 * 3 * scale);
  line(ctx, pad, W * 0.105, W - pad, W * 0.105);

  // ekspedisi + tanggal
  font("bold", Math.round(18 * scale));
  ctx.textAlign = "left";
  ctx.fillText((payload.ekspedisi || "REGULER").toUpperCase(), pad, W * 0.165);
  font("normal", Math.round(11 * scale));
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
    const img = await loadCanvasImage(generateBarcodeDataUrl(payload.no_resi));
    ctx.drawImage(img, pad + W * 0.03, y, W - (pad + W * 0.03) * 2, W * 0.135);
  } catch {
    /* abaikan bila barcode gagal */
  }
  y += W * 0.165;
  font("bold", Math.round(15 * scale), "Courier New");
  ctx.textAlign = "center";
  ctx.fillText(payload.no_resi, W / 2, y);
  y += W * 0.03;
  line(ctx, pad, y, W - pad, y);

  // PENGIRIM
  y += W * 0.05;
  font("bold", Math.round(9 * scale));
  ctx.textAlign = "left";
  ctx.fillText("PENGIRIM", pad, y);
  y += W * 0.04;
  font("bold", Math.round(13 * scale));
  ctx.fillText("Fuji Electric", pad, y);
  ctx.textAlign = "right";
  font("normal", Math.round(11 * scale));
  ctx.fillText("0877-7980-3435", W - pad, y);
  y += W * 0.04;
  ctx.textAlign = "left";
  ctx.fillText("Tasikmalaya", pad, y);

  y += W * 0.03;
  line(ctx, pad, y, W - pad, y);

  // PENERIMA
  y += W * 0.05;
  font("bold", Math.round(9 * scale));
  ctx.fillText("PENERIMA", pad, y);
  y += W * 0.04;
  const recipient = payload.username || "-";
  fitText(ctx, recipient, W * 0.55, Math.round(15 * scale), "bold");
  ctx.fillText(recipient, pad, y);
  if (payload.phone) {
    ctx.textAlign = "right";
    fitText(ctx, payload.phone, W * 0.32, Math.round(11 * scale));
    ctx.fillText(payload.phone, W - pad, y);
    ctx.textAlign = "left";
  }
  y += W * 0.04;
  font("normal", Math.round(12 * scale));
  const kotaLines = splitLines(ctx, payload.kota || "-", W - pad * 2);
  kotaLines.forEach((l) => {
    ctx.fillText(l, pad, y);
    y += W * 0.04;
  });

  y += W * 0.02;
  if (y < H - W * 0.12) {
    line(ctx, pad, y, W - pad, y);
    y += W * 0.04;
    font("bold", Math.round(9 * scale));
    ctx.fillText("DETAIL", pad, y);
    y += W * 0.04;
    font("normal", Math.round(11 * scale));
    const maxLines = Math.max(1, Math.floor((H - W * 0.06 - y) / (W * 0.038)));
    const teks = splitLines(ctx, `Neon: ${payload.text_neon || "-"}`, W - pad * 2).slice(0, maxLines);
    teks.forEach((l) => {
      ctx.fillText(l, pad, y);
      y += W * 0.038;
    });
    if (payload.order_no && y < H - W * 0.05) {
      font("normal", Math.round(9 * scale));
      ctx.fillText(`No. Order: ${payload.order_no}`, pad, y);
    }
  }

  font("italic", Math.round(8 * scale));
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
  const scanScale = Math.max(2, targetWidthPx / base.width);
  const scanViewport = page.getViewport({ scale: scanScale });
  const scan = document.createElement("canvas");
  scan.width = Math.max(1, Math.floor(scanViewport.width));
  scan.height = Math.max(1, Math.floor(scanViewport.height));
  const scanCtx = scan.getContext("2d");
  if (!scanCtx) throw new Error("Kanvas label tidak tersedia");
  scanCtx.fillStyle = "#fff";
  scanCtx.fillRect(0, 0, scan.width, scan.height);
  await page.render({ canvasContext: scanCtx, viewport: scanViewport, canvas: scan } as any).promise;

  const pixels = scanCtx.getImageData(0, 0, scan.width, scan.height).data;
  let left = scan.width;
  let right = 0;
  let top = scan.height;
  let bottom = 0;
  for (let y = 0; y < scan.height; y += 2) {
    for (let x = 0; x < scan.width; x += 2) {
      const i = (y * scan.width + x) * 4;
      if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right <= left || bottom <= top) return scan;

  const cropPad = Math.max(4, Math.round(scan.width * 0.01));
  left = Math.max(0, left - cropPad);
  right = Math.min(scan.width - 1, right + cropPad);
  top = Math.max(0, top - cropPad);
  bottom = Math.min(scan.height - 1, bottom + cropPad);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const scale = targetWidthPx / cropWidth;
  const viewport = { width: targetWidthPx, height: Math.ceil(cropHeight * scale) };
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scan, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ---------- API publik ----------

/** Cetak resi manual aplikasi ke printer termal. */
export async function printResiThermal(payload: ResiPayload): Promise<void> {
  const s = await loadPrinterSettings();
  const canvas = await renderResiCanvas(payload, pxForWidth(s), s.insetDots);
  await printCanvas(canvas, s.density);
}

/** Cetak label Shopee (PDF tersimpan) ke printer termal. */
export async function printShopeeLabelThermal(orderId: string): Promise<void> {
  const { fetchShopeeLabelUrl } = await import("@/lib/shopee-label");
  const url = await fetchShopeeLabelUrl(orderId);
  try {
    const s = await loadPrinterSettings();
    const canvas = await renderPdfUrlToCanvas(url, Math.max(256, pxForWidth(s) - s.insetDots * 2));
    await printCanvas(canvas, s.density);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Cetak PDF dari object URL apa pun (mis. preview Shopee). */
export async function printPdfUrlThermal(url: string): Promise<void> {
  const s = await loadPrinterSettings();
  const content = await renderPdfUrlToCanvas(url, Math.max(256, pxForWidth(s) - s.insetDots * 2));
  const canvas = document.createElement("canvas");
  canvas.width = pxForWidth(s);
  canvas.height = content.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kanvas label tidak tersedia");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(content, s.insetDots, 0);
  await printCanvas(canvas, s.density);
}

/** Halaman tes cetak. */
export async function printTestThermal(): Promise<void> {
  const s = await loadPrinterSettings();
  const W = pxForWidth(s);
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
  await printCanvas(canvas, s.density);
}
