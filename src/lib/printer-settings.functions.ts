import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAuth } from "@/lib/app-auth";

export type PrintAlign = "left" | "center" | "right";

export type PrinterSettings = {
  widthMm: number;
  dots58: number;
  dots80: number;
  insetDots: number;
  density: 1 | 2 | 3;
  /** lebar total titik printer (manual) */
  paperDots: number;
  /** lebar area cetak isi (manual, <= paperDots) */
  contentDots: number;
  align: PrintAlign;
};

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  widthMm: 58,
  dots58: 384,
  dots80: 576,
  insetDots: 16,
  density: 2,
  paperDots: 384,
  contentDots: 360,
  align: "center",
};

function toSettings(row: any): PrinterSettings {
  const paperDots = Number(row?.paper_dots ?? 576);
  return {
    widthMm: Number(row?.width_mm ?? 58),
    dots58: Number(row?.dots_58 ?? 384),
    dots80: Number(row?.dots_80 ?? 576),
    insetDots: Number(row?.inset_dots ?? 16),
    density: Number(row?.density ?? 2) as 1 | 2 | 3,
    paperDots,
    contentDots: Math.min(paperDots, Number(row?.content_dots ?? paperDots)),
    align: (row?.align ?? "center") as PrintAlign,
  };
}

async function requireAdminOrOwner(context: any) {
  const { data, error } = await context.supabase.rpc("is_admin_or_owner", {
    _user_id: context.userId,
  });
  if (error || !data) throw new Error("Hanya admin atau owner yang dapat mengubah pengaturan printer");
}

export const getPrinterSettings = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("printer_settings")
      .select("width_mm,dots_58,dots_80,inset_dots,density,paper_dots,content_dots,align")
      .eq("id", 1)
      .single();
    if (error) throw new Error(error.message);
    return toSettings(data);
  });

const settingsSchema = z.object({
  widthMm: z.number().int().min(30).max(120),
  dots58: z.number().int().min(256).max(576),
  dots80: z.number().int().min(384).max(640),
  insetDots: z.number().int().min(0).max(64),
  density: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  paperDots: z.number().int().min(128).max(1024),
  contentDots: z.number().int().min(128).max(1024),
  align: z.enum(["left", "center", "right"]),
});

export const updatePrinterSettings = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .inputValidator((data: unknown) => settingsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await requireAdminOrOwner(context);
    const { error } = await context.supabase
      .from("printer_settings")
      .update({
        width_mm: data.widthMm,
        dots_58: data.dots58,
        dots_80: data.dots80,
        inset_dots: data.insetDots,
        density: data.density,
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return data;
  });