import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, ListOrdered, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useMenuLayout } from "@/hooks/useMenuLayout";
import { NAV_ITEMS, GROUP_LABELS, GROUP_ORDER, type NavGroup, type MenuLayout } from "@/lib/nav-items";

export const Route = createFileRoute("/_authenticated/owner/menu-order")({
  component: MenuOrderPage,
  head: () => ({
    meta: [
      { title: "Susunan Menu — Neon Workflow" },
      { name: "description", content: "Atur urutan dan pengelompokan menu sidebar secara manual." },
      { property: "og:title", content: "Susunan Menu — Neon Workflow" },
      { property: "og:description", content: "Atur urutan dan pengelompokan menu sidebar secara manual." },
    ],
  }),
});

const registry = new Map(NAV_ITEMS.map((i) => [i.url, i]));

function MenuOrderPage() {
  const { layout, update, reset } = useMenuLayout();

  const move = (url: string, dir: -1 | 1) => {
    const group = layout.find((l) => l.url === url)?.group;
    if (!group) return;
    const idxInGroup = layout.filter((l) => l.group === group).findIndex((l) => l.url === url);
    const groupItems = layout.filter((l) => l.group === group);
    const target = idxInGroup + dir;
    if (target < 0 || target >= groupItems.length) return;
    const reordered = [...groupItems];
    [reordered[idxInGroup], reordered[target]] = [reordered[target], reordered[idxInGroup]];
    const next: MenuLayout = [];
    let cursor = 0;
    for (const item of layout) {
      if (item.group === group) next.push(reordered[cursor++]);
      else next.push(item);
    }
    update(next);
  };

  const changeGroup = (url: string, group: NavGroup) => {
    const next = layout.filter((l) => l.url !== url);
    // put at end of target group
    let insertAt = next.length;
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].group === group) { insertAt = i + 1; break; }
    }
    next.splice(insertAt, 0, { url, group });
    update(next);
    toast.success("Menu dipindahkan ke grup " + GROUP_LABELS[group]);
  };

  return (
    <div className="edge-to-edge p-0 sm:p-4 space-y-4 max-w-3xl">
      <div className="flex items-start gap-2 px-3 sm:px-0 pt-3 sm:pt-0">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow">
          <ListOrdered className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold">Susunan Menu</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Urutkan dan kelompokkan menu sidebar sesuai kebiasaan Anda. Tersimpan di perangkat ini.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { reset(); toast.success("Susunan direset ke bawaan"); }}>
          <RotateCcw className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Reset</span>
        </Button>
      </div>

      {GROUP_ORDER.map((g) => {
        const items = layout.filter((l) => l.group === g);
        return (
          <Card key={g}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{GROUP_LABELS[g]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada menu di grup ini.</p>
              )}
              {items.map((entry, idx) => {
                const item = registry.get(entry.url);
                if (!item) return null;
                const Icon = item.icon;
                return (
                  <div key={entry.url} className="flex items-center gap-2 rounded-md border px-2 py-2">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">{item.url}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {GROUP_ORDER.filter((x) => x !== g).map((x) => (
                        <Button key={x} variant="ghost" size="sm" className="h-8 px-2 text-[11px]"
                          onClick={() => changeGroup(entry.url, x)}>
                          → {GROUP_LABELS[x]}
                        </Button>
                      ))}
                      <Button variant="outline" size="icon" className="h-8 w-8"
                        disabled={idx === 0} onClick={() => move(entry.url, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" className="h-8 w-8"
                        disabled={idx === items.length - 1} onClick={() => move(entry.url, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
