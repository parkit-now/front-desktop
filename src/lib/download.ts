export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Chromium starts downloads asynchronously; retain the URL until it has begun.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
