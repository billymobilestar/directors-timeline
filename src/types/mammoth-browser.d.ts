// src/types/mammoth-browser.d.ts
declare module 'mammoth/mammoth.browser' {
  // Mammoth's browser bundle exposes these functions.
  // We keep types loose to avoid fighting the UMD shape during SSR builds.
  export const convertToHtml: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  export const extractRawText: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  export const convertToMarkdown: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
}