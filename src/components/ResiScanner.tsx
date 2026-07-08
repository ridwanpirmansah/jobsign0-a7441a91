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
        ],
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 12, qrbox: { width: 260, height: 140 } },
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
      <div id={containerId} className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-black/90 aspect-[16/10]" />
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
