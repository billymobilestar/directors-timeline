// src/types/pdfjs-dist.d.ts

// Minimal declarations so TS stops complaining during Next/Vercel builds.
// We keep them loose because the UMD/ESM shape differs across versions.

declare module 'pdfjs-dist/build/pdf' {
  export const GlobalWorkerOptions: any;
  export function getDocument(src: any): any;
}

declare module 'pdfjs-dist/legacy/build/pdf' {
  export const GlobalWorkerOptions: any;
  export function getDocument(src: any): any;
}