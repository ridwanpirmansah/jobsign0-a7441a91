import { useCallback, useEffect, useState } from "react";
import {
  loadLayout, saveLayout, defaultLayout, MENU_LAYOUT_KEY,
  type MenuLayout,
} from "@/lib/nav-items";

export function useMenuLayout() {
  const [layout, setLayout] = useState<MenuLayout>(() => defaultLayout());

  useEffect(() => {
    setLayout(loadLayout());
    const sync = () => setLayout(loadLayout());
    window.addEventListener("menu-layout-changed", sync);
    const onStorage = (e: StorageEvent) => { if (e.key === MENU_LAYOUT_KEY) sync(); };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("menu-layout-changed", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((next: MenuLayout) => {
    setLayout(next);
    saveLayout(next);
  }, []);

  const reset = useCallback(() => {
    const d = defaultLayout();
    setLayout(d);
    saveLayout(d);
  }, []);

  return { layout, update, reset };
}
