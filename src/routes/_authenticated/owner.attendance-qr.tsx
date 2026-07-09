import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, ShieldCheck, Download, CalendarDays, Printer, Infinity as InfinityIcon, MapPin, LocateFixed } from "lucide-react";
import { toast } from "sonner";
import { computeToken, currentWindow, secondsLeftInWindow, WINDOW_SECONDS } from "@/lib/attendance-token";
import { format } from "date-fns";
import WorkshopRadiusMap from "@/components/WorkshopRadiusMap";

export const Route = createFileRoute("/_authenticated/owner/attendance-qr")({
  component: AttendanceQrPage,
});

function AttendanceQrPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dailyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const permCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [token, setToken] = useState<string>("");
  const [secsLeft, setSecsLeft] = useState<number>(WINDOW_SECONDS);
  const [dailyDate, setDailyDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [locLat, setLocLat] = useState<string>("");
  const [locLng, setLocLng] = useState<string>("");
  const [locRadius, setLocRadius] = useState<string>("100");
  const [locEnforce, setLocEnforce] = useState<boolean>(false);
  const [gettingLoc, setGettingLoc] = useState<boolean>(false);

  const { data: secret, isLoading, error } = useQuery({
    enabled: me?.role === "owner" || me?.role === "admin",
    queryKey: ["attendance-secret"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_attendance_secret");
      if (error) throw error;
      return data as string;
    },
    staleTime: Infinity,
  });

  const { data: dailyToken, isFetching: dailyFetching } = useQuery({
    enabled: (me?.role === "owner" || me?.role === "admin") && !!dailyDate,
    queryKey: ["attendance-daily-token", dailyDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_daily_attendance_token", { _date: dailyDate });
      if (error) throw error;
      return data as string;
    },
    staleTime: 1000 * 60 * 60,
  });

  const { data: permToken } = useQuery({
    enabled: me?.role === "owner" || me?.role === "admin",
    queryKey: ["attendance-perm-token"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_permanent_attendance_token");
      if (error) throw error;
      return data as string;
    },
    staleTime: Infinity,
  });

  const { data: settings } = useQuery({
    enabled: me?.role === "owner" || me?.role === "admin",
    queryKey: ["attendance-settings-loc"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_settings")
        .select("workshop_lat, workshop_lng, radius_meters, enforce_location")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!settings) return;
    setLocLat(settings.workshop_lat != null ? String(settings.workshop_lat) : "");
    setLocLng(settings.workshop_lng != null ? String(settings.workshop_lng) : "");
    setLocRadius(String(settings.radius_meters ?? 100));
    setLocEnforce(!!settings.enforce_location);
  }, [settings]);

  const saveLocMut = useMutation({
    mutationFn: async () => {
      const lat = parseFloat(locLat);
      const lng = parseFloat(locLng);
      const radius = parseInt(locRadius, 10);
      if (!isFinite(lat) || !isFinite(lng)) throw new Error("Latitude/Longitude tidak valid");
      if (!isFinite(radius) || radius < 10) throw new Error("Radius minimal 10 meter");
      const { error } = await supabase.rpc("update_attendance_location", {
        _lat: lat, _lng: lng, _radius: radius, _enforce: locEnforce,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pengaturan lokasi tersimpan");
      qc.invalidateQueries({ queryKey: ["attendance-settings-loc"] });
      qc.invalidateQueries({ queryKey: ["att-settings-meta"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) { toast.error("Perangkat tidak mendukung geolokasi"); return; }
    setGettingLoc(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocLat(pos.coords.latitude.toFixed(6));
        setLocLng(pos.coords.longitude.toFixed(6));
        setGettingLoc(false);
        toast.success("Lokasi saat ini dipakai");
      },
      (err) => { setGettingLoc(false); toast.error(err.message); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const rotateMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rotate_attendance_secret");
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Kunci QR berhasil dirotasi. Semua QR lama tidak berlaku.");
      qc.invalidateQueries({ queryKey: ["attendance-secret"] });
      qc.invalidateQueries({ queryKey: ["attendance-daily-token"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!secret) return;
    let cancelled = false;
    const tick = async () => {
      const w = currentWindow();
      const t = await computeToken(secret, w);
      if (cancelled) return;
      setToken(t);
      setSecsLeft(secondsLeftInWindow());
      if (canvasRef.current) {
        try {
          await QRCode.toCanvas(canvasRef.current, t, { width: 320, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
        } catch { /* ignore */ }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [secret]);

  useEffect(() => {
    if (!dailyToken || !dailyCanvasRef.current) return;
    QRCode.toCanvas(dailyCanvasRef.current, dailyToken, {
      width: 360, margin: 2, color: { dark: "#0f172a", light: "#ffffff" },
    }).catch(() => undefined);
  }, [dailyToken]);

  useEffect(() => {
    if (!permToken || !permCanvasRef.current) return;
    QRCode.toCanvas(permCanvasRef.current, permToken, {
      width: 360, margin: 2, color: { dark: "#0f172a", light: "#ffffff" },
    }).catch(() => undefined);
  }, [permToken]);

  const downloadPerm = async () => {
    if (!permToken) return;
    const dataUrl = await QRCode.toDataURL(permToken, {
      width: 1024, margin: 4, color: { dark: "#0f172a", light: "#ffffff" },
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qr-absensi-permanen.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const printPerm = () => {
    if (!permToken || !permCanvasRef.current) return;
    const url = permCanvasRef.current.toDataURL("image/png");
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR Absensi Permanen</title>
      <style>body{font-family:system-ui;text-align:center;padding:24px}h1{font-size:20px;margin:8px 0}p{color:#475569;font-size:13px;margin:4px 0 16px}img{width:90%;max-width:480px}</style>
      </head><body><h1>QR Absensi Permanen</h1><p>Berlaku selamanya (kecuali kunci dirotasi)</p>
      <img src="${url}" /><p style="margin-top:16px">Scan untuk Check-In / Check-Out</p>
      <script>window.onload=()=>{setTimeout(()=>window.print(),300)}<\/script></body></html>`);
    w.document.close();
  };

  const downloadDaily = async () => {
    if (!dailyToken) return;
    const dataUrl = await QRCode.toDataURL(dailyToken, {
      width: 1024, margin: 4, color: { dark: "#0f172a", light: "#ffffff" },
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qr-absensi-${dailyDate}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const printDaily = () => {
    if (!dailyToken) return;
    const canvas = dailyCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR Absensi ${dailyDate}</title>
      <style>body{font-family:system-ui;text-align:center;padding:24px}h1{font-size:20px;margin:8px 0}p{color:#475569;font-size:13px;margin:4px 0 16px}img{width:90%;max-width:480px}</style>
      </head><body><h1>QR Absensi Harian</h1><p>Berlaku hanya tanggal <b>${dailyDate}</b></p>
      <img src="${url}" /><p style="margin-top:16px">Scan untuk Check-In / Check-Out</p>
      <script>window.onload=()=>{setTimeout(()=>window.print(),300)}<\/script></body></html>`);
    w.document.close();
  };

  if (me && me.role !== "owner" && me.role !== "admin") {
    return <div className="p-6 text-sm text-rose-600">Akses ditolak. Hanya owner/admin.</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          QR Absensi Workshop
        </h1>
        <p className="text-sm text-slate-500">Tampilkan QR ini di workshop. Karyawan wajib scan untuk check-in / check-out. QR berganti otomatis setiap {WINDOW_SECONDS} detik.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">QR Aktif (rotasi {WINDOW_SECONDS} detik)</CardTitle>
          <Badge variant="secondary" className="font-mono">Ganti dalam {secsLeft}s</Badge>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-slate-500">Memuat kunci QR…</p>}
          {error && <p className="text-sm text-rose-600">Gagal memuat: {(error as Error).message}</p>}
          {secret && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm">
                <canvas ref={canvasRef} className="block" />
              </div>
              <div className="text-center">
                <div className="text-xs uppercase tracking-wide text-slate-400">Token saat ini</div>
                <div className="font-mono text-lg font-semibold text-slate-700">{token || "—"}</div>
              </div>
              <div className="w-full max-w-md">
                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-1000 ease-linear"
                    style={{ width: `${(secsLeft / WINDOW_SECONDS) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-amber-600" />
            QR Harian Cadangan (cetak / unduh)
          </CardTitle>
          <Badge variant="outline" className="border-amber-300 text-amber-700">Berlaku 1 hari</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            QR ini hanya berlaku pada tanggal yang dipilih. Cetak dan tempel di workshop sebagai cadangan
            apabila QR rotasi tidak bisa diakses. Besok harinya, unduh ulang QR untuk tanggal berikutnya.
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">Tanggal berlaku</Label>
              <Input
                type="date"
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
                className="w-44"
              />
            </div>
            <Button onClick={downloadDaily} disabled={!dailyToken || dailyFetching} variant="outline">
              <Download className="h-4 w-4 mr-2" /> Unduh PNG
            </Button>
            <Button onClick={printDaily} disabled={!dailyToken || dailyFetching} variant="outline">
              <Printer className="h-4 w-4 mr-2" /> Cetak
            </Button>
          </div>
          {dailyToken && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <div className="rounded-2xl border-2 border-amber-200 bg-white p-4 shadow-sm">
                <canvas ref={dailyCanvasRef} className="block" />
              </div>
              <div className="text-xs text-slate-500">Hanya berlaku tanggal <b>{dailyDate}</b></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-emerald-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <InfinityIcon className="h-4 w-4 text-emerald-600" />
            QR Absensi Permanen
          </CardTitle>
          <Badge variant="outline" className="border-emerald-300 text-emerald-700">Seumur hidup</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            QR ini berlaku selamanya (tidak berganti otomatis). Cetak dan tempel di workshop untuk absensi
            harian. QR ini hanya menjadi tidak berlaku bila Anda merotasi kunci QR di bagian Keamanan.
            Kombinasikan dengan validasi lokasi di bawah agar QR tidak bisa dipakai dari luar workshop.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={downloadPerm} disabled={!permToken} variant="outline">
              <Download className="h-4 w-4 mr-2" /> Unduh PNG
            </Button>
            <Button onClick={printPerm} disabled={!permToken} variant="outline">
              <Printer className="h-4 w-4 mr-2" /> Cetak
            </Button>
          </div>
          {permToken && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <div className="rounded-2xl border-2 border-emerald-200 bg-white p-4 shadow-sm">
                <canvas ref={permCanvasRef} className="block" />
              </div>
              <div className="text-xs text-slate-500">Berlaku selamanya</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-sky-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-sky-600" />
            Validasi Lokasi (Radius Workshop)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            Aktifkan untuk mewajibkan karyawan berada dalam radius yang ditentukan dari workshop saat scan QR.
            Karyawan akan diminta izin lokasi oleh browser saat melakukan absensi.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Latitude</Label>
              <Input value={locLat} onChange={(e) => setLocLat(e.target.value)} placeholder="-6.200000" />
            </div>
            <div>
              <Label className="text-xs">Longitude</Label>
              <Input value={locLng} onChange={(e) => setLocLng(e.target.value)} placeholder="106.816666" />
            </div>
            <div>
              <Label className="text-xs">Radius (meter)</Label>
              <Input type="number" min={10} value={locRadius} onChange={(e) => setLocRadius(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={locEnforce}
                  onChange={(e) => setLocEnforce(e.target.checked)}
                />
                Wajibkan validasi lokasi saat scan
              </label>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={useMyLocation} variant="outline" disabled={gettingLoc}>
              <LocateFixed className="h-4 w-4 mr-2" /> Pakai Lokasi Saya Sekarang
            </Button>
            <Button onClick={() => saveLocMut.mutate()} disabled={saveLocMut.isPending}>
              Simpan Pengaturan
            </Button>
            {locLat && locLng && (
              <a
                href={`https://www.google.com/maps?q=${locLat},${locLng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center text-sm text-sky-700 hover:underline px-3 py-2"
              >
                Lihat di Google Maps
              </a>
            )}
          </div>

          {(() => {
            const lat = parseFloat(locLat);
            const lng = parseFloat(locLng);
            const r = parseInt(locRadius, 10);
            if (!isFinite(lat) || !isFinite(lng)) {
              return (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Isi Latitude & Longitude (atau gunakan tombol "Pakai Lokasi Saya Sekarang") untuk menampilkan peta.
                </div>
              );
            }
            return (
              <WorkshopRadiusMap
                workshopLat={lat}
                workshopLng={lng}
                radius={isFinite(r) && r >= 10 ? r : 100}
                editable
                height={320}
                onWorkshopChange={(la, ln) => {
                  setLocLat(la.toFixed(6));
                  setLocLng(ln.toFixed(6));
                }}
              />
            );
          })()}
        </CardContent>
      </Card>



      {me?.role === "owner" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Keamanan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              Jika Anda curiga kunci bocor (misalnya ada karyawan menyimpan screenshot kunci secret), rotasi kunci untuk menonaktifkan semua QR sebelumnya. QR harian yang sudah dicetak juga akan ikut tidak berlaku.
            </p>
            <Button
              variant="outline"
              onClick={() => rotateMut.mutate()}
              disabled={rotateMut.isPending}
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Rotasi Kunci QR
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
