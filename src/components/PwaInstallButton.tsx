import { useState } from "react";
import { Download, X } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export function PwaInstallButton() {
  const { canInstall, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  if (!canInstall || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
      <button
        onClick={async () => {
          const outcome = await promptInstall();
          if (outcome === "dismissed") setDismissed(true);
        }}
        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-xl hover:scale-[1.02] active:scale-95"
        aria-label="Install Web App"
      >
        <Download className="h-4 w-4" />
        Install Web App
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="rounded-full bg-white/90 p-1.5 text-slate-500 shadow-md hover:bg-white hover:text-slate-700"
        aria-label="Tutup"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
