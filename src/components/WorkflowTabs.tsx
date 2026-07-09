import { Link, useRouterState } from "@tanstack/react-router";
import { ShoppingBag, FolderKanban, Package, FileEdit } from "lucide-react";

const TABS = [
  { to: "/orders", label: "Order", icon: ShoppingBag },
  { to: "/projects", label: "Project", icon: FolderKanban },
  { to: "/ready-stock", label: "Ready Stock", icon: Package },
  { to: "/drafts", label: "Draft", icon: FileEdit },
] as const;

export function WorkflowTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="-mx-2 sm:mx-0 mb-3 overflow-x-auto no-scrollbar">
      <nav
        role="tablist"
        aria-label="Bagian order"
        className="flex gap-1 px-2 sm:px-0 min-w-max border-b border-slate-200"
      >
        {TABS.map((t) => {
          const active =
            t.to === "/projects"
              ? pathname.startsWith("/projects")
              : pathname === t.to;
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              role="tab"
              aria-selected={active}
              className={[
                "inline-flex items-center gap-1.5 whitespace-nowrap px-3 sm:px-4 py-2 text-sm font-medium rounded-t-md transition-colors",
                "border-b-2 -mb-px",
                active
                  ? t.to === "/drafts"
                    ? "border-amber-500 text-amber-700 bg-amber-50"
                    : "border-indigo-600 text-indigo-700 bg-indigo-50/60"
                  : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
