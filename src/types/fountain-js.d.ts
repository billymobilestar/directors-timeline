declare module 'fountain-js' {
  // The lib can export either a function or an object with .parse
  const anyExport:
    | ((text: string) => { title?: string; script?: Array<{ type: string; text?: string; scene_number?: string }> })
    | { parse: (text: string) => { title?: string; script?: Array<{ type: string; text?: string; scene_number?: string }> } };
  export = anyExport;
}