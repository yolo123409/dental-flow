import { supabase } from "@/lib/supabase";

export async function getSecureDownloadUrl(
  filePath: string
): Promise<string | null> {
  if (!filePath) return null;

  const { data, error } = await supabase.storage
    .from("product-files")
    .createSignedUrl(filePath, 60);

  if (error) {
    console.error(error);
    return null;
  }

  return data.signedUrl;
}