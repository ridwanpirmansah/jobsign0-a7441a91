import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
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
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastRef = useRef<{ text: string; ts: number }>({ text: "", ts: 0 });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      const scanner = new Html5Qrcode(containerId, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ],
        useBarCodeDetectorIfSupported: true,
      } as any);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: { ideal: "environment" } as any },
        {
          fps: 15,
          // Wide, tall qrbox positioned near top so the phone can be held
          // close to the barcode — no need to move far to fit it inside.
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const width = Math.floor(Math.min(viewfinderWidth * 0.95, 520));
            const height = Math.floor(Math.min(viewfinderHeight * 0.65, 260));
            return { width, height };
          },
          aspectRatio: 4 / 3,
          videoConstraints: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            // iOS Safari benefits from continuous focus.
            advanced: [{ focusMode: "continuous" }, { focusMode: "auto" }],
          } as any,
          disableFlip: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        } as any,
        (decoded) => {
          const now = Date.now();
          const t = decoded.trim();
          if (!t) return;
          if (t === lastRef.current.text && now - lastRef.current.ts < cooldownMs) return;
          lastRef.current = { text: t, ts: now };
          onScan(t);
        },
        () => {},
      );

      // Try to nudge iOS auto-focus after start.
      try {
        const video = document.querySelector<HTMLVideoElement>(`#${containerId} video`);
        const stream = video?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks?.()[0];
        const caps: any = track?.getCapabilities?.() ?? {};
        const constraints: any = {};
        if (caps.focusMode?.includes?.("continuous")) constraints.focusMode = "continuous";
        if (caps.zoom) constraints.zoom = Math.min(caps.zoom.max ?? 1, Math.max(caps.zoom.min ?? 1, 1.5));
        if (Object.keys(constraints).length && track) {
          await track.applyConstraints({ advanced: [constraints] } as any);
        }
      } catch { /* ignore */ }

      setRunning(true);
    } catch (e: any) {
      setError(e?.message ?? "Kamera tidak bisa diakses");
    }
  };

  const stop = async () => {
    try {
      if (scannerRef.current?.isScanning) await scannerRef.current.stop();
      await scannerRef.current?.clear();
    } catch {}
    scannerRef.current = null;
    setRunning(false);
  };

  useEffect(() => () => { stop(); }, []);
  useEffect(() => { if (!active && running) stop(); }, [active]);

  return (
    <div className={className}>
      <div
        id={containerId}
        className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-black/90 aspect-[4/3] [&_video]:object-cover"
      />
      <p className="text-[11px] text-muted-foreground text-center mt-1">
        Dekatkan kamera hingga barcode mengisi kotak. iOS: tunggu 1-2 detik agar fokus otomatis mengunci.
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
