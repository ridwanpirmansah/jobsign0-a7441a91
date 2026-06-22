import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Zap } from "lucide-react";
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
            <Zap className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Neon Workflow System</h1>
          <p className="text-sm text-slate-400">Manajemen produksi & upah karyawan</p>
        </div>

        <Card className="border border-slate-200 shadow-2xl shadow-black/10">
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
                    <Input
                      id="li-pass"
                      type="password"
                      required
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                  <Button type="submit" className="w-full mt-2 font-medium" disabled={loading}>
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
                    <Input
                      id="su-pass"
                      type="password"
                      required
                      minLength={6}
                      value={signupPass}
                      onChange={(e) => setSignupPass(e.target.value)}
                      placeholder="Min. 6 karakter"
                    />
                  </div>
                  <Button type="submit" className="w-full mt-2 font-medium" disabled={loading}>
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
