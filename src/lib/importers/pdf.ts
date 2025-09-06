// src/lib/importers/pdf.ts
// Client-side PDF text extraction with pdfjs-dist (legacy build).
// Kept minimal and robust for Vercel builds without Node shims.

export async function extractPdfText(file: File): Promise<string> {
  // Always use the legacy build for maximum compatibility
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf');

  // You can optionally set a worker; for small docs, disable the worker.
  // pdfjs.GlobalWorkerOptions.workerSrc =
  //   'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const data = new Uint8Array(await file.arrayBuffer());

  // Disable worker to avoid worker bundling/SSR issues in Next
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    // render not needed; we only extract text
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;

  const chunks: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // join all text runs for this page
    const text = content.items
      .map((it: any) => ('str' in it ? it.str : (it?.text || '')))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) chunks.push(text);
  }

  const full = chunks.join('\n\n').replace(/\r\n/g, '\n');
  try { await doc.destroy?.(); } catch {}
  return full;
}