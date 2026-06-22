import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listPrices, updatePrice } from "@/lib/orders.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Tags, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/owner/prices")({
  component: PricesPage,
  head: () => ({ meta: [{ title: "Master Harga Bahan" }] }),
});

function PricesPage() {
  const fetchPrices = useServerFn(listPrices);
  const savePrice = useServerFn(updatePrice);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["material_prices"], queryFn: () => fetchPrices() });
  const [edits, setEdits] = useState<Record<string, string>>({});

  const mut = useMutation({
    mutationFn: (v: { key: string; value: number }) => savePrice({ data: v }),
    onSuccess: (_, v) => {
      toast.success(`${v.key} tersimpan`);
      setEdits((e) => { const c = { ...e }; delete c[v.key]; return c; });
      qc.invalidateQueries({ queryKey: ["material_prices"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal simpan"),
  });

  if (isLoading) return <div className="p-4">Memuat...</div>;

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Tags className="h-6 w-6"/> Master Harga Bahan</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Harga ini dipakai untuk kalkulasi HPP setiap order. Ubah nilai dan klik Simpan.
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Daftar Harga</CardTitle><CardDescription>Hanya owner yang bisa mengubah.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bahan</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead className="w-48">Harga (Rp)</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((p: any) => {
                const editing = edits[p.key];
                const current = editing ?? String(p.value);
                const changed = editing !== undefined && Number(editing) !== Number(p.value);
                return (
                  <TableRow key={p.key}>
                    <TableCell className="font-medium">{p.label}<div className="text-xs text-muted-foreground">{p.key}</div></TableCell>
                    <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} value={current}
                        onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" disabled={!changed || mut.isPending}
                        onClick={() => mut.mutate({ key: p.key, value: Number(editing) })}>
                        <Save className="h-3 w-3 mr-1"/> Simpan
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
