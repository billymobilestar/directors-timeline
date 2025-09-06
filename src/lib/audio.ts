'use client';

/**
 * Robustly decodes an uploaded audio File into an AudioBuffer.
 * - Supports both Promise and callback forms of decodeAudioData (Safari/WebKit).
 * - Fallback to OfflineAudioContext if the main context fails.
 * - Gives a clean, helpful error message when decoding isn't possible.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  if (typeof window === 'undefined') {
    throw new Error('Audio decoding must run in the browser.');
  }

  const arrayBuffer = await file.arrayBuffer();

  const AudioCtx: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;

  if (!AudioCtx) {
    throw new Error('Web Audio API not supported in this browser.');
  }

  // Helper: works with both promise & callback variants
  const decodeWith = (ctx: AudioContext | OfflineAudioContext, buf: ArrayBuffer) =>
    new Promise<AudioBuffer>((resolve, reject) => {
      const maybePromise = (ctx as any).decodeAudioData(
        buf.slice(0), // clone for Safari
        (decoded: AudioBuffer) => resolve(decoded),
        (err: any) => reject(err)
      );
      // If browser returns a Promise instead of using callbacks, use it.
      if (maybePromise && typeof (maybePromise as Promise<AudioBuffer>).then === 'function') {
        (maybePromise as Promise<AudioBuffer>).then(resolve).catch(reject);
      }
    });

  // Primary attempt with a normal AudioContext (created during user gesture: file input change)
  const ctx = new AudioCtx();
  try {
    const decoded = await decodeWith(ctx, arrayBuffer);
    // Don't close the context immediately; Safari can be touchy.
    try { await ctx.suspend(); } catch {}
    return decoded;
  } catch (primaryErr) {
    // Fallback: try OfflineAudioContext; some containers/codecs decode here more reliably.
    try {
      const OfflineCtx: typeof OfflineAudioContext | undefined =
        (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;

      if (!OfflineCtx) throw primaryErr;

      // Minimal offline context; parameters don’t matter for decodeAudioData
      const offline = new OfflineCtx(1, 44100 * 2, 44100);
      const decoded = await decodeWith(offline, arrayBuffer);
      return decoded;
    } catch (fallbackErr) {
      // Surface a helpful message
      const msg = [
        'Could not decode this audio file.',
        'Try a common format like MP3, WAV, AAC/M4A, or OGG.',
      ].join(' ');
      console.error('decodeAudioFile failed:', primaryErr, fallbackErr);
      throw new Error(msg);
    } finally {
      try { await ctx.suspend(); } catch {}
    }
  }
}
