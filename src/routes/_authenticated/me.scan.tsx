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
import { speakId, beepError, primeSpeech } from "@/lib/scan-feedback";
import WorkshopRadiusMap, { haversineMeters } from "@/components/WorkshopRadiusMap";

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
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [posErr, setPosErr] = useState<string | null>(null);

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
      const speech =
        res.action === "check_in" ? "Check In berhasil, selamat bekerja"
        : res.action === "check_out" ? "Check Out berhasil, selamat istirahat"
        : res.action === "break_end" ? "Selamat kembali bekerja"
        : res.action === "check_out_final" ? "Check Out berhasil, sampai jumpa besok"
        : "Absensi berhasil";
      speakId(speech);
      setLast({ ok: true, message: `${label} berhasil dicatat`, action: res.action });
      qc.invalidateQueries({ queryKey: ["att-today"] });
      qc.invalidateQueries({ queryKey: ["my-attendance"] });
      qc.invalidateQueries({ queryKey: ["my-att"] });
    },
    onError: (e: Error) => {
      beepError();
      setLast({ ok: false, message: e.message });
    },
    onSettled: () => {
      setTimeout(() => { processingRef.current = false; lastTokenRef.current = ""; }, 1500);
    },
  });

  const start = async () => {
    if (running) return;
    primeSpeech();
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
    if (!settings?.enforce_location) return;
    if (!("geolocation" in navigator)) {
      setPosErr("Perangkat tidak mendukung geolokasi");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setPosErr(null);
      },
      (e) => setPosErr(e.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [settings?.enforce_location]);

  useEffect(() => {
    if (!last) return;
    const id = setTimeout(() => setLast(null), 3500);
    return () => clearTimeout(id);
  }, [last]);

  const workshopLat = settings?.workshop_lat ?? null;
  const workshopLng = settings?.workshop_lng ?? null;
  const radius = settings?.radius_meters ?? 100;
  const distance =
    pos && workshopLat != null && workshopLng != null
      ? haversineMeters(workshopLat, workshopLng, pos.lat, pos.lng)
      : null;
  const inside = distance != null ? distance <= radius : null;

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
        <Card className={inside === false ? "border-rose-200" : inside ? "border-emerald-200" : "border-sky-200"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4 text-sky-600" />
              Validasi Lokasi (radius {radius} m)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {workshopLat == null || workshopLng == null ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                Admin belum menetapkan koordinat workshop. Hubungi admin.
              </div>
            ) : (
              <WorkshopRadiusMap
                workshopLat={workshopLat}
                workshopLng={workshopLng}
                radius={radius}
                userLat={pos?.lat}
                userLng={pos?.lng}
                height={240}
              />
            )}
            {posErr && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                Gagal membaca lokasi: {posErr}
              </div>
            )}
            {!pos && !posErr && workshopLat != null && (
              <div className="text-xs text-slate-500">Mengambil lokasi Anda… izinkan akses lokasi bila diminta.</div>
            )}
            {inside === false && (
              <div className="text-xs font-medium text-rose-700">
                Anda berada di luar radius workshop. Scan akan ditolak.
              </div>
            )}
            {inside === true && (
              <div className="text-xs font-medium text-emerald-700">
                Anda berada di dalam radius. Silakan scan QR.
              </div>
            )}
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
