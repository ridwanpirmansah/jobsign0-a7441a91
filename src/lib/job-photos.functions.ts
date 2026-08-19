import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(100),
  dataBase64: z.string().min(10),
});

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

export const uploadJobPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const driveKey = process.env["GOOGLE_DRIVE_API_KEY"];
    if (!lovableKey || !driveKey) {
      throw new Error("Google Drive belum terhubung. Hubungkan konektor Google Drive terlebih dahulu.");
    }
    if (!data.mimeType.startsWith("image/")) throw new Error("File harus berupa gambar");

    const headers = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": driveKey,
    };

    const boundary = `lovable${Math.random().toString(36).slice(2)}`;
    const metadata = { name: data.filename, mimeType: data.mimeType };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${data.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${data.dataBase64}\r\n` +
      `--${boundary}--`;

    const res = await fetch(`${GATEWAY}/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`, {
      method: "POST",
      headers: { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[Drive] upload failed [${res.status}]: ${text}`);
      throw new Error(`Upload ke Google Drive gagal [${res.status}]: ${text}`);
    }
    const file = (await res.json()) as { id: string; webViewLink?: string };

    // Make it viewable by anyone with the link so admins can review the photo.
    const permRes = await fetch(`${GATEWAY}/drive/v3/files/${file.id}/permissions`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
    if (!permRes.ok) {
      console.error(`[Drive] permission failed [${permRes.status}]: ${await permRes.text()}`);
    }

    return {
      url: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
      fileId: file.id,
    };
  });
