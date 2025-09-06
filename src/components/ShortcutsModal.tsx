'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';

export default function ShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] bg-black/50" onClick={onClose}>
      <div
        className="mx-auto mt-24 w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h3 className="text-neutral-400 mb-2">Global</h3>
            <ul className="space-y-2">
              <li className="flex items-center justify-between">
                <span>Command Menu</span><kbd className="kbd">⌘/Ctrl + K</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>Switch to Music</span><kbd className="kbd">G then M</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>Switch to Film</span><kbd className="kbd">G then F</kbd>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-neutral-400 mb-2">Timeline</h3>
            <ul className="space-y-2">
              <li className="flex items-center justify-between">
                <span>Play/Pause (music)</span><kbd className="kbd">Space</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>Zoom In/Out</span><kbd className="kbd">= / -</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>Add Note / Scene</span><kbd className="kbd">N / S</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span>Delete Selection</span><kbd className="kbd">⌫ / Del</kbd>
              </li>
            </ul>
          </div>
        </div>

        <style jsx>{`
          .kbd {
            background: #0a0a0a;
            border: 1px solid #3f3f46;
            padding: 2px 6px;
            border-radius: 6px;
            font-size: 12px;
            min-width: 60px;
            text-align: center;
            color: #e5e7eb;
          }
        `}</style>
      </div>
    </div>
  );
}