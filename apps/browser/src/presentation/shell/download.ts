/**
 * Triggers a browser download of an in-memory blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Delay revocation so the browser has time to initiate the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
