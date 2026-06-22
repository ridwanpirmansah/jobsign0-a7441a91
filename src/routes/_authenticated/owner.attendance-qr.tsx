import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { computeToken, currentWindow, secondsLeftInWindow, WINDOW_SECONDS } from "@/lib/attendance-token";

export const Route = createFileRoute("/_authenticated/owner/attendance-qr")({
  component: AttendanceQrPage,
});

function AttendanceQrPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [token, setToken] = useState<string>("");
  const [secsLeft, setSecsLeft] = useState<number>(WINDOW_SECONDS);

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

  const rotateMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rotate_attendance_secret");
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Kunci QR berhasil dirotasi. Semua QR lama tidak berlaku.");
      qc.invalidateQueries({ queryKey: ["attendance-secret"] });
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
          <CardTitle className="text-base">QR Aktif</CardTitle>
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

      {me?.role === "owner" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Keamanan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              Jika Anda curiga kunci bocor (misalnya ada karyawan menyimpan screenshot kunci secret), rotasi kunci untuk menonaktifkan semua QR sebelumnya.
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
