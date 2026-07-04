import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Camera, CheckCircle2, XCircle, ArrowLeft, MapPin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/me/scan")({
  component: ScanPage,
});

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Perangkat tidak mendukung geolokasi"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000,
    });
  });
}

type LastResult = { ok: boolean; message: string; action?: string };

function ScanPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const containerId = "att-qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<LastResult | null>(null);
  const processingRef = useRef(false);
  const lastTokenRef = useRef<string>("");

  const { data: settings } = useQuery({
    queryKey: ["att-settings-meta"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_settings")
        .select("enforce_location, radius_meters, workshop_lat, workshop_lng")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const checkInMut = useMutation({
    mutationFn: async (token: string) => {
      let lat: number | undefined;
      let lng: number | undefined;
      if (settings?.enforce_location) {
        try {
          const pos = await getPosition();
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch (e) {
          throw new Error("Izinkan akses lokasi untuk absensi: " + (e as Error).message);
        }
      }
      const { data, error } = await supabase.rpc("attendance_check_in", {
        _token: token,
        _lat: lat,
        _lng: lng,
      });
      if (error) throw error;
      return data as { action: string; time: string };
    },
    onSuccess: (res) => {
      const label =
        res.action === "check_in" ? "Check-IN"
        : res.action === "check_out" ? "Check-OUT (sementara)"
        : res.action === "break_end" ? "Selesai Istirahat — lanjut kerja"
        : res.action === "check_out_final" ? "Check-OUT (pulang)"
        : res.action;
      setLast({ ok: true, message: `${label} berhasil dicatat`, action: res.action });
      qc.invalidateQueries({ queryKey: ["att-today"] });
      qc.invalidateQueries({ queryKey: ["my-attendance"] });
      qc.invalidateQueries({ queryKey: ["my-att"] });
    },
    onError: (e: Error) => {
      setLast({ ok: false, message: e.message });
    },
    onSettled: () => {
      setTimeout(() => { processingRef.current = false; lastTokenRef.current = ""; }, 1500);
    },
  });

  const start = async () => {
    if (running) return;
    try {
      const scanner = new Html5Qrcode(containerId, { verbose: false });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (processingRef.current) return;
          if (decoded === lastTokenRef.current) return;
          if (!decoded || decoded.length < 6) return;
          processingRef.current = true;
          lastTokenRef.current = decoded;
          checkInMut.mutate(decoded);
        },
        () => { /* ignore frame errors */ },
      );
      setRunning(true);
    } catch (e) {
      toast.error("Tidak bisa mengakses kamera: " + (e as Error).message);
    }
  };

  const stop = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try { await s.stop(); await s.clear(); } catch { /* noop */ }
    scannerRef.current = null;
    setRunning(false);
  };

  useEffect(() => () => { stop(); }, []);

  useEffect(() => {
    if (!last) return;
    const id = setTimeout(() => setLast(null), 3500);
    return () => clearTimeout(id);
  }, [last]);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <Link to="/dashboard" className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Kembali ke Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Scan QR Absensi</h1>
        <p className="text-sm text-slate-500">Scan QR yang ditampilkan di Workshop. Jeda minimal 10 menit antar scan.</p>
      </div>

      {!me?.employee?.id && (
        <Card>
          <CardContent className="p-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded">
            Akun Anda belum terhubung ke data karyawan. Minta admin menyambungkan terlebih dahulu.
          </CardContent>
        </Card>
      )}

      {settings?.enforce_location && (
        <Card className="border-sky-200 bg-sky-50">
          <CardContent className="p-3 text-sm text-sky-800 flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Absensi wajib berada dalam radius {settings.radius_meters ?? 100} m dari workshop. Izinkan akses lokasi saat diminta.
          </CardContent>
        </Card>
      )}


      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2"><Camera className="h-4 w-4" /> Kamera</CardTitle>
          {running && <Badge variant="secondary">Memindai…</Badge>}
        </CardHeader>
        <CardContent className="space-y-3">
          <div id={containerId} className="w-full rounded-lg overflow-hidden bg-slate-900 aspect-square" />
          {!running ? (
            <Button onClick={start} disabled={!me?.employee?.id} className="w-full">
              <Camera className="h-4 w-4 mr-2" /> Mulai Scan
            </Button>
          ) : (
            <Button onClick={stop} variant="secondary" className="w-full">Berhenti</Button>
          )}
        </CardContent>
      </Card>

      {last && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className={last.ok ? "border-emerald-300 bg-emerald-50 shadow-xl w-full max-w-sm" : "border-rose-300 bg-rose-50 shadow-xl w-full max-w-sm"}>
            <CardContent className="p-6 flex flex-col items-center text-center gap-4">
              {last.ok ? (
                <div className="rounded-full bg-emerald-100 p-4">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                </div>
              ) : (
                <div className="rounded-full bg-rose-100 p-4">
                  <XCircle className="h-10 w-10 text-rose-600" />
                </div>
              )}
              <div>
                <div className={`text-xl font-bold ${last.ok ? "text-emerald-800" : "text-rose-800"}`}>
                  {last.ok ? "Berhasil" : "Gagal"}
                </div>
                <div className={`text-base mt-1 ${last.ok ? "text-emerald-700" : "text-rose-700"}`}>
                  {last.message}
                </div>
              </div>
              <button
                onClick={() => setLast(null)}
                className={`mt-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  last.ok
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-rose-600 text-white hover:bg-rose-700"
                }`}
              >
                Tutup
              </button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
