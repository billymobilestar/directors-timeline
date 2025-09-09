export type Note = {
  id: string;
  timestampSec: number;
  xOffsetPx: number;
  yPx: number;
  text: string;
  color: string;
  w: number;
  h: number;
  collapsed?: boolean;
};

export type LyricsClip = {
  id: string;
  text: string;
  timestampSec: number;
  endSec?: number;
  color: string;
  w?: number;
  h?: number;
};

export type Marker = { id: string; sec: number; label: string; color: string };

export type AudioProjectV1 = {
  version: 1;
  kind: 'dtmusic';
  projectName: string;
  zoom: number;
  panX: number;
  playheadSec: number;
  waveAmp: number;
  notes: Note[];
  audioMeta?: { fileName?: string; duration?: number } | null;
};