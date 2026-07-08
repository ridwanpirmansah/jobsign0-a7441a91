import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listCarriers, upsertCarrier, deleteCarrier } from "@/lib/orders.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Truck, Plus, Trash2, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/owner/carriers")({
  component: CarriersPage,
  head: () => ({ meta: [{ title: "Master Ekspedisi" }] }),
});

function CarriersPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listCarriers);
  const save = useServerFn(upsertCarrier);
  const remove = useServerFn(deleteCarrier);
  const { data, isLoading } = useQuery({ queryKey: ["shipping_carriers"], queryFn: () => fetchList() });

  const [newName, setNewName] = useState("");
  const [newOrder, setNewOrder] = useState("0");

  const saveMut = useMutation({
    mutationFn: (v: any) => save({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipping_carriers"] }); toast.success("Tersimpan"); },
    onError: (e: any) => toast.error(e?.message ?? "Gagal simpan"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shipping_carriers"] }); toast.success("Terhapus"); },
    onError: (e: any) => toast.error(e?.message ?? "Gagal hapus"),
  });

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Truck className="h-6 w-6"/> Master Ekspedisi</h1>
        <p className="text-sm text-muted-foreground mt-1">Kelola daftar ekspedisi yang bisa dipilih saat input order.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Tambah Ekspedisi</CardTitle></CardHeader>
        <CardContent className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs text-muted-foreground">Nama</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nama ekspedisi" />
          </div>
          <div className="w-24">
            <label className="text-xs text-muted-foreground">Urutan</label>
            <Input type="number" value={newOrder} onChange={(e) => setNewOrder(e.target.value)} />
          </div>
          <Button
            disabled={!newName.trim() || saveMut.isPending}
            onClick={() => {
              saveMut.mutate({ name: newName.trim(), active: true, sort_order: Number(newOrder) || 0 });
              setNewName(""); setNewOrder("0");
            }}
          >
            <Plus className="h-4 w-4 mr-1"/> Tambah
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Ekspedisi</CardTitle>
          <CardDescription>Nonaktifkan untuk menyembunyikan dari pilihan tanpa menghapus.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <div>Memuat…</div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead className="w-24">Urutan</TableHead>
                  <TableHead className="w-24">Aktif</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((c: any) => (
                  <CarrierRow key={c.id} row={c} onSave={(v) => saveMut.mutate(v)} onDelete={() => delMut.mutate(c.id)} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CarrierRow({ row, onSave, onDelete }: { row: any; onSave: (v: any) => void; onDelete: () => void }) {
  const [name, setName] = useState(row.name);
  const [order, setOrder] = useState(String(row.sort_order));
  const [active, setActive] = useState<boolean>(row.active);
  const changed = name !== row.name || Number(order) !== row.sort_order || active !== row.active;
  return (
    <TableRow>
      <TableCell><Input value={name} onChange={(e) => setName(e.target.value)} /></TableCell>
      <TableCell><Input type="number" value={order} onChange={(e) => setOrder(e.target.value)} /></TableCell>
      <TableCell><Switch checked={active} onCheckedChange={setActive} /></TableCell>
      <TableCell className="flex gap-1">
        <Button size="sm" disabled={!changed || !name.trim()}
          onClick={() => onSave({ id: row.id, name: name.trim(), active, sort_order: Number(order) || 0 })}>
          <Save className="h-3 w-3"/>
        </Button>
        <Button size="sm" variant="outline" onClick={() => { if (confirm(`Hapus ${row.name}?`)) onDelete(); }}>
          <Trash2 className="h-3 w-3"/>
        </Button>
      </TableCell>
    </TableRow>
  );
}
