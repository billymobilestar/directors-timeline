export type LineType =
  | 'scene'        // Scene heading (INT./EXT. ...)
  | 'action'       // Action/description
  | 'character'    // Character cue (ALL CAPS)
  | 'parenthetical'// (whispering)
  | 'dialogue'     // Dialogue lines
  | 'transition'   // CUT TO:, FADE OUT:
  | 'lyric'        // ~ lyrics
  | 'general';     // Fallback

export type ScriptLine = {
  type: LineType;
  text: string;     // raw line w/o trailing newline
};

export type SceneBlock = {
  index: number;           // 1-based order in the script
  heading: string;         // scene heading line (normalized)
  slug: string;            // INT./EXT. LOCATION - TIME (normalized slug)
  startLine: number;       // 0-based index of heading line
  lines: ScriptLine[];     // all lines until next scene heading
  description: string;     // concatenated action/dialogue in plain text
  estLengthSec: number;    // estimated length in seconds
  positionSec: number;     // cumulative placement (filled after parse pass)
};

export type ParsedScript = {
  scenes: SceneBlock[];
  warnings: string[];
};