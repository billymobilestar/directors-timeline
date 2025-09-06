// src/lib/importers/docx.ts
// Client-side DOCX text extraction using Mammoth's browser build.
// This is only called from file inputs (client), so no SSR issues.

export async function extractDocxText(file: File): Promise<string> {
  // Dynamically load the browser bundle (avoids Node shims)
  const { extractRawText } = await import('mammoth/mammoth.browser');

  const arrayBuffer = await file.arrayBuffer();
  const result = await extractRawText({ arrayBuffer });
  const text = (result?.value || '').trim();

  // Normalize newlines so downstream parsers behave consistently
  return text.replace(/\r\n/g, '\n');
}