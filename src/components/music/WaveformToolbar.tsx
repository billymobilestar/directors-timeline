'use client';
import React from 'react';

type Props = {
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStep: (deltaSec: number) => void;
  onAddNote: () => void;

  projectName: string;
  onProjectNameChange: (s: string) => void;

  onExportProject: () => void;
  openProjectInputRef: React.RefObject<HTMLInputElement>;
  onOpenProjectChosen: React.ChangeEventHandler<HTMLInputElement>;
  onOpenProjectClick: () => void;

  onAnalyzeClick: () => void;
  onLyricsOpen: () => void;

  onAddMarkerAtPlayhead: () => void;

  onDeleteSelected: () => void;
  deleteDisabled: boolean;

  loopEnabled: boolean;
  setLoopEnabled: (b: boolean) => void;
  onSetLoopA: () => void;
  onSetLoopB: () => void;
  onClearLoop: () => void;

  snappingEnabled: boolean;
  setSnappingEnabled: (b: boolean) => void;

  lyricsOffsetSec: number;
  setLyricsOffsetSec: (n: number) => void;

  waveAmp: number;
  setWaveAmp: (n: number) => void;

  zoom: number;
  setZoom: (n: number) => void;

  dragMovesTimestamp: boolean;
  setDragMovesTimestamp: (b: boolean) => void;

  playheadLabel: string;
};

export default function WaveformToolbar(props: Props) {
  const {
    isPlaying, onPlay, onPause, onStep, onAddNote,
    projectName, onProjectNameChange,
    onExportProject, openProjectInputRef, onOpenProjectChosen, onOpenProjectClick,
    onAnalyzeClick, onLyricsOpen,
    onAddMarkerAtPlayhead,
    onDeleteSelected, deleteDisabled,
    loopEnabled, setLoopEnabled, onSetLoopA, onSetLoopB, onClearLoop,
    snappingEnabled, setSnappingEnabled,
    lyricsOffsetSec, setLyricsOffsetSec,
    waveAmp, setWaveAmp,
    zoom, setZoom,
    dragMovesTimestamp, setDragMovesTimestamp,
    playheadLabel,
  } = props;

  return (
    <div
      className="border-b border-neutral-800 flex items-center gap-3 flex-wrap transition-[height,padding,margin,border] duration-200 ease-out p-2"
      onWheel={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <button className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500" onClick={() => isPlaying ? onPause() : onPlay()}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => onStep(-5)}>-5s</button>
      <button className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => onStep(+5)}>+5s</button>
      <button className="px-3 py-1.5 rounded bg-amber-500 text-black hover:bg-amber-400" onClick={onAddNote}>Add note</button>

      <input
        type="text"
        value={projectName}
        onChange={(e) => onProjectNameChange(e.target.value)}
        className="px-2 py-1 rounded bg-neutral-900 border border-neutral-700 w-56"
        placeholder="Project name"
      />

      <button
        className="px-3 py-1.5 rounded bg-emerald-600 text-black hover:bg-emerald-500"
        onClick={onExportProject}
        title="Save to .dtmusic.json"
      >
        Save Project
      </button>
      <input
        ref={openProjectInputRef}
        type="file"
        accept=".json,.dtmusic.json"
        className="hidden"
        onChange={onOpenProjectChosen}
      />
      <button
        className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700"
        onClick={onOpenProjectClick}
        title="Open a saved .dtmusic.json project"
      >
        Open Project
      </button>

      <button
        className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
        onClick={onDeleteSelected}
        disabled={deleteDisabled}
        title="Delete selected note or lyric clip"
      >
        Delete
      </button>

      <button
        className="px-3 py-1.5 rounded bg-fuchsia-600 hover:bg-fuchsia-500"
        onClick={onAnalyzeClick}
        title="Analyze audio with AI (transcription + timestamps)"
      >
        Analyze (AI)
      </button>

      <button
        className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500"
        onClick={onLyricsOpen}
        title="Paste or import lyrics to align"
      >
        Lyrics
      </button>

      <button
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500"
        onClick={onAddMarkerAtPlayhead}
        title="Add marker at playhead"
      >
        + Marker @
      </button>

      <label className="text-sm text-neutral-300 flex items-center gap-2 ml-2">
        <input type="checkbox" checked={loopEnabled} onChange={(e) => setLoopEnabled(e.target.checked)} />
        Loop
      </label>
      <button className="px-2 py-1 rounded bg-purple-700 hover:bg-purple-600" onClick={onSetLoopA} title="Set loop A">Set A</button>
      <button className="px-2 py-1 rounded bg-purple-700 hover:bg-purple-600" onClick={onSetLoopB} title="Set loop B">Set B</button>
      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700" onClick={onClearLoop} title="Clear loop">Clear</button>

      <button
        id="ai-audio-trigger"
        className="hidden"
        onClick={onAnalyzeClick}
        aria-hidden
      />

      <label className="text-sm text-neutral-300 flex items-center gap-2">
        <input type="checkbox" checked={snappingEnabled} onChange={(e) => setSnappingEnabled(e.target.checked)} />
        Snap to grid
      </label>

      <label className="text-sm text-neutral-300 flex items-center gap-2">
        Offset
        <input
          type="range"
          min={-50}
          max={50}
          step={0.01}
          value={lyricsOffsetSec}
          onChange={(e) => setLyricsOffsetSec(parseFloat(e.target.value))}
          className="w-36"
        />
        <span className="w-16 text-right tabular-nums">{lyricsOffsetSec.toFixed(2)}s</span>
      </label>

      <label className="ml-2 text-sm text-neutral-300 flex items-center gap-2">
        WF amp
        <input
          type="range"
          min={0.1}
          max={0.5}
          step={0.01}
          value={waveAmp}
          onChange={(e) => setWaveAmp(parseFloat(e.target.value))}
          className="w-28"
        />
        <span className="w-10 text-right tabular-nums">{Math.round(waveAmp * 100)}%</span>
      </label>

      <label className="text-sm text-neutral-300 flex items-center gap-2">
        Zoom
        <input
          type="range"
          min={20}
          max={800}
          step={1}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="w-40"
        />
        <span className="w-14 text-right tabular-nums">{Math.round(zoom)} px/s</span>
      </label>

      <label className="text-sm text-neutral-300 flex items-center gap-2">
        <input
          type="checkbox"
          checked={dragMovesTimestamp}
          onChange={(e) => setDragMovesTimestamp(e.target.checked)}
        />
        Drag moves timestamp
      </label>

      <div className="ml-auto flex items-center gap-3 text-sm text-neutral-400">
        <span>Playhead: {playheadLabel}</span>
      </div>
    </div>
  );
}