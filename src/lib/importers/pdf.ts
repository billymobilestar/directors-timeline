// src/lib/importers/pdf.ts
// Stable client-side PDF text extraction using pdfjs-dist v3.11.174
// This version avoids engine warnings and works well with Next.js 14.

// IMPORTANT: Ensure you have installed:
//   npm i pdfjs-dist@3.11.174

const PDFJS_VERSION = '3.11.174';

// Types for the small subset we use
type PdfModule = {
  getDocument: (src: any) => any;
  GlobalWorkerOptions: { workerSrc: string };
};

let pdfMod: PdfModule | null = null;

export async function extractPdfText(file: File): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('PDF parsing must run in the browser.');
  }

  if (!pdfMod) {
    // Use the v3 build path which is stable with older Node versions
    const mod: any = await import('pdfjs-dist/build/pdf');
    if (!mod?.getDocument || !mod?.GlobalWorkerOptions) {
      throw new Error('Could not initialize pdfjs-dist build/pdf');
    }
    mod.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
    pdfMod = mod as PdfModule;
  }

  const { getDocument } = pdfMod!;
  const data = new Uint8Array(await file.arrayBuffer());

  // Disable eval to avoid CSP/mismatch issues observed in some setups.
  const task = getDocument({ data, isEvalSupported: false });
  const pdf = await task.promise;

  let text = '';
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = (content.items || []).map((it: any) => {
      if (typeof it?.str === 'string') return it.str;
      if (typeof it === 'string') return it;
      return '';
    });
    text += strings.join('\n') + '\n\n';
  }

  return text;
}