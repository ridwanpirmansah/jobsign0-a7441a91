import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  label?: string;
  className?: string;
};

export function TablePagination({ page, pageSize, total, onPageChange, onPageSizeChange, label = "baris", className }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, totalPages);
  const start = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const end = Math.min(cur * pageSize, total);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 text-sm ${className ?? ""}`}>
      <div className="text-muted-foreground">
        {total === 0 ? `Tidak ada ${label}` : `Menampilkan ${start}–${end} dari ${total} ${label}`}
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-xs text-muted-foreground">Tampilkan</span>
        <Select value={String(pageSize)} onValueChange={(v) => { onPageSizeChange(Number(v)); onPageChange(1); }}>
          <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-8 w-8" disabled={cur <= 1} onClick={() => onPageChange(1)} aria-label="Halaman pertama"><ChevronsLeft className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" className="h-8 w-8" disabled={cur <= 1} onClick={() => onPageChange(cur - 1)} aria-label="Sebelumnya"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="px-2 whitespace-nowrap">Hal <b>{cur}</b> / {totalPages}</span>
          <Button size="icon" variant="outline" className="h-8 w-8" disabled={cur >= totalPages} onClick={() => onPageChange(cur + 1)} aria-label="Berikutnya"><ChevronRight className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" className="h-8 w-8" disabled={cur >= totalPages} onClick={() => onPageChange(totalPages)} aria-label="Halaman terakhir"><ChevronsRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}
