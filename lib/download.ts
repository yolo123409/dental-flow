import { getSecureDownloadUrl } from "./storage";

export async function downloadProduct(filePath: string) {
  if (!filePath) {
    alert("Download not available.");
    return;
  }

  const signedUrl = await getSecureDownloadUrl(filePath);

  if (!signedUrl) {
    alert("Unable to generate download link.");
    return;
  }

  window.open(signedUrl, "_blank", "noopener,noreferrer");
}