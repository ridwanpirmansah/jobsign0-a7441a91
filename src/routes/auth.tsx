import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Zap, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Login - Neon Workflow System" },
      { name: "description", content: "Sistem manajemen produksi neon sign & upah karyawan." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPass, setSignupPass] = useState("");
  const [showLoginPass, setShowLoginPass] = useState(false);
  const [showSignupPass, setShowSignupPass] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPass,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Berhasil masuk");
    navigate({ to: "/" });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPass,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: signupName },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Akun dibuat. Silakan login.");
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#f8f9fe] p-4">
      {/* Soft neon background blobs */}
      <div
        className="pointer-events-none absolute -top-24 -left-24 h-[28rem] w-[28rem] rounded-full opacity-50"
        style={{
          background: "radial-gradient(circle, #ff4ecd 0%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />
      <div
        className="pointer-events-none absolute top-1/2 -right-32 h-[24rem] w-[24rem] rounded-full opacity-45"
        style={{
          background: "radial-gradient(circle, #00e5ff 0%, transparent 70%)",
          filter: "blur(70px)",
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-20 left-1/3 h-[22rem] w-[22rem] rounded-full opacity-40"
        style={{
          background: "radial-gradient(circle, #a855f7 0%, transparent 70%)",
          filter: "blur(70px)",
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo & Title */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              background: "linear-gradient(135deg, #ff4ecd, #ff9050)",
              boxShadow: "0 0 24px rgba(255,78,205,0.35), 0 0 48px rgba(255,144,80,0.2)",
            }}
          >
            <Zap className="h-8 w-8 text-white" />
          </div>
          <h1
            className="text-2xl font-extrabold tracking-tight text-center"
            style={{
              color: "#1a1a2e",
              textShadow: "0 0 10px rgba(255,78,205,0.25), 0 0 20px rgba(0,229,255,0.15)",
            }}
          >
            Neon Workflow System
          </h1>
          <p className="text-sm text-slate-500 font-medium">Manajemen produksi & upah karyawan</p>
        </div>

        <Card className="border border-white/60 shadow-2xl shadow-black/5 backdrop-blur-sm bg-white/90">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Selamat datang</CardTitle>
            <CardDescription>Masuk atau daftarkan akun baru</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-lg h-11">
                <TabsTrigger
                  value="login"
                  className="rounded-md text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  Masuk
                </TabsTrigger>
                <TabsTrigger
                  value="signup"
                  className="rounded-md text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  Daftar
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-5">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="li-email" className="text-sm">Email</Label>
                    <Input
                      id="li-email"
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="nama@email.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="li-pass" className="text-sm">Password</Label>
                    <div className="relative">
                      <Input
                        id="li-pass"
                        type={showLoginPass ? "text" : "password"}
                        required
                        value={loginPass}
                        onChange={(e) => setLoginPass(e.target.value)}
                        placeholder="••••••••"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        aria-label={showLoginPass ? "Sembunyikan password" : "Tampilkan password"}
                        onClick={() => setShowLoginPass((v) => !v)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-900"
                      >
                        {showLoginPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full mt-2 font-semibold text-white border-0"
                    style={{
                      background: "linear-gradient(135deg, #ff4ecd, #ff6b35)",
                      boxShadow: "0 4px 16px rgba(255,78,205,0.35)",
                    }}
                  >
                    {loading ? "Memproses..." : "Masuk"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-5">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="su-name" className="text-sm">Nama Lengkap</Label>
                    <Input
                      id="su-name"
                      required
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                      placeholder="John Doe"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-email" className="text-sm">Email</Label>
                    <Input
                      id="su-email"
                      type="email"
                      required
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="nama@email.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-pass" className="text-sm">Password</Label>
                    <div className="relative">
                      <Input
                        id="su-pass"
                        type={showSignupPass ? "text" : "password"}
                        required
                        minLength={6}
                        value={signupPass}
                        onChange={(e) => setSignupPass(e.target.value)}
                        placeholder="Min. 6 karakter"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        aria-label={showSignupPass ? "Sembunyikan password" : "Tampilkan password"}
                        onClick={() => setShowSignupPass((v) => !v)}
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-900"
                      >
                        {showSignupPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full mt-2 font-semibold text-white border-0"
                    style={{
                      background: "linear-gradient(135deg, #00e5ff, #2979ff)",
                      boxShadow: "0 4px 16px rgba(0,229,255,0.35)",
                    }}
                  >
                    {loading ? "Memproses..." : "Daftar"}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    Pengguna pertama otomatis menjadi <strong>owner</strong>.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <Toaster richColors position="top-right" />
      </div>
    </div>
  );
}
