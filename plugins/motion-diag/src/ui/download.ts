/** Offers `blob` to the user as a file download (a click on a temporary link). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // The browser starts the download synchronously on click; release the URL a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `motion-diag-<printer>-<yyyymmdd-hhmmss>`: a file base name that is safe on every file system. */
export function fileBaseName(printerName: string, now = new Date()): string {
  const slug = printerName
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return ['motion-diag', slug, stamp].filter(Boolean).join('-');
}
