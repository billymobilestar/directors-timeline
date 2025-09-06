// src/lib/importers/docx.ts
// Client-side DOCX text extractor using mammoth (browser build)

export async function extractDocxText(file: File): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('DOCX parsing must run in the browser.');
  }

  // Use the browser build so we don’t need Node-specific shims
  const mammoth: any = await import('mammoth/mammoth.browser');

  const arrayBuffer = await file.arrayBuffer();

  // Convert DOCX to plain text (you could also use convertToMarkdown/HTML)
  const { value: text } = await mammoth.extractRawText({ arrayBuffer });

  // Normalize newlines
  return (text || '').replace(/\r\n/g, '\n');
}