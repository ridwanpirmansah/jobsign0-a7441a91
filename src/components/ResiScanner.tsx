import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarcodeFormat,
  BrowserCodeReader,
  BrowserMultiFormatOneDReader,
  type IScannerControls,
} from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff } from "lucide-react";

type Props = {
  onScan: (text: string) => void;
  active?: boolean;
  className?: string;
  cooldownMs?: number;
};

export function ResiScanner({ onScan, active = true, className, cooldownMs = 2500 }: Props) {
  const containerId = useRef(`resi-scan-${Math.random().toString(36).slice(2, 8)}`).current;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatOneDReader | null>(null);
  const nativeDetectorRef = useRef<any>(null);
  const nativeTimerRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const lastRef = useRef<{ text: string; ts: number }>({ text: "", ts: 0 });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emitScan = useCallback((raw: string) => {
    const now = Date.now();
    const t = raw.trim();
    if (!t) return;
    if (t === lastRef.current.text && now - lastRef.current.ts < cooldownMs) return;
    lastRef.current = { text: t, ts: now };
    onScan(t);
  }, [cooldownMs, onScan]);

  const makeHints = () => {
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    return hints;
  };

  const tuneCamera = async () => {
    try {
      const stream = videoRef.current?.srcObject as MediaStream | null;
      const track = stream?.getVideoTracks?.()[0];
      const caps: any = track?.getCapabilities?.() ?? {};
      const advanced: any[] = [];
      const focusMode = caps.focusMode?.includes?.("continuous")
        ? "continuous"
        : caps.focusMode?.includes?.("auto")
          ? "auto"
          : null;
      if (focusMode) advanced.push({ focusMode });
      if (caps.exposureMode?.includes?.("continuous")) advanced.push({ exposureMode: "continuous" });
      if (caps.zoom) {
        const min = caps.zoom.min ?? 1;
        const max = caps.zoom.max ?? 1;
        advanced.push({ zoom: Math.min(max, Math.max(min, 1.15)) });
      }
      if (track && advanced.length) await track.applyConstraints({ advanced } as any);
    } catch { /* camera capabilities differ per device */ }
  };

  const stopNativeDetector = () => {
    if (nativeTimerRef.current != null) {
      window.clearTimeout(nativeTimerRef.current);
      nativeTimerRef.current = null;
    }
  };

  const startNativeDetector = () => {
    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) return;
      nativeDetectorRef.current = new Detector({
        formats: ["code_128", "code_39", "code_93", "ean_13", "ean_8", "itf", "codabar", "upc_a", "upc_e"],
      });
    } catch {
      nativeDetectorRef.current = null;
      return;
    }

    const loop = async () => {
      if (!activeRef.current || !nativeDetectorRef.current || !videoRef.current) return;
      try {
        if (videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const results = await nativeDetectorRef.current.detect(videoRef.current);
          const value = results?.[0]?.rawValue;
          if (typeof value === "string") emitScan(value);
        }
      } catch { /* keep ZXing fallback running */ }
      if (activeRef.current) nativeTimerRef.current = window.setTimeout(loop, 80);
    };
    void loop();
  };

  const stop = useCallback(() => {
    activeRef.current = false;
    stopNativeDetector();
    try { controlsRef.current?.stop(); } catch { /* noop */ }
    try { BrowserCodeReader.releaseAllStreams(); } catch { /* noop */ }
    if (videoRef.current) videoRef.current.srcObject = null;
    controlsRef.current = null;
    readerRef.current = null;
    nativeDetectorRef.current = null;
    setRunning(false);
  }, []);

  const startReader = async (constraints: MediaStreamConstraints) => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Elemen video belum siap");
    }
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay might be blocked briefly; retry once after a tick.
      await new Promise((r) => setTimeout(r, 100));
      try { await video.play(); } catch { /* iOS will play on user gesture */ }
    }

    const reader = new BrowserMultiFormatOneDReader(makeHints(), {
      delayBetweenScanAttempts: 35,
      delayBetweenScanSuccess: Math.max(300, Math.min(cooldownMs, 900)),
      tryPlayVideoTimeout: 8000,
    });
    readerRef.current = reader;
    controlsRef.current = await reader.decodeFromVideoElement(video, (result) => {
      if (result) emitScan(result.getText());
    });
    setRunning(true);
    await tuneCamera();
    startNativeDetector();
  };

  const start = async () => {
    if (running) return;
    setError(null);
    stop();
    activeRef.current = true;
    try {
      await startReader({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, min: 15 },
        } as any,
        audio: false,
      });
    } catch (primaryError: any) {
      stop();
      activeRef.current = true;
      try {
        await startReader({ video: { facingMode: "environment" }, audio: false });
      } catch (fallbackError: any) {
        try {
          await startReader({ video: true, audio: false });
        } catch (finalError: any) {
          activeRef.current = false;
          setError(finalError?.message ?? fallbackError?.message ?? primaryError?.message ?? "Kamera tidak bisa diakses");
        }
      }
    }
  };

  useEffect(() => () => { stop(); }, []);
  useEffect(() => { if (!active && running) stop(); }, [active]);

  return (
    <div className={className}>
      <div
        id={containerId}
        className="relative w-full max-w-md mx-auto rounded-lg overflow-hidden bg-black/90 aspect-[4/3]"
      >
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          autoPlay
          muted
          playsInline
          webkit-playsinline="true"
        />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="relative h-[40%] w-[96%] rounded-md border-2 border-white/95 shadow-[0_0_0_999px_rgba(0,0,0,0.14)]">
            <div className="absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-400/90 shadow" />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground text-center mt-1">
        Seluruh area kamera aktif. Dekatkan barcode hingga memenuhi kotak putih, lalu tahan sebentar.
      </p>
      <div className="mt-2 flex gap-2 justify-center">
        {!running ? (
          <Button size="sm" onClick={start}><Camera className="h-4 w-4 mr-1"/> Mulai Scan</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={stop}><CameraOff className="h-4 w-4 mr-1"/> Berhenti</Button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 text-center mt-2">{error}</p>}
    </div>
  );
}
