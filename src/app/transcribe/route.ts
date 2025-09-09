import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs'; // ensure Node runtime

type Word = { text: string; start: number; end: number }; // seconds

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const AAI_KEY = process.env.ASSEMBLYAI_API_KEY;
    if (!AAI_KEY) {
      return jsonError(
        'Server missing ASSEMBLYAI_API_KEY. Add it in Vercel → Settings → Environment Variables, or in .env.local for local dev.',
        500
      );
    }

    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('multipart/form-data')) {
      return jsonError("Expected multipart/form-data with a file field named 'audio'.", 400);
    }

    const formData = await req.formData();
    const file = formData.get('audio') as File | null;
    if (!file) return jsonError("Missing 'audio' file.", 400);

    // --- Upload to AssemblyAI WITHOUT streaming (no duplex) ---
    const arrayBuffer = await file.arrayBuffer();
    // Use Blob/ArrayBuffer instead of Buffer so TS/Fetch BodyInit is satisfied in this runtime
    const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' });

    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        authorization: AAI_KEY,
        // content-length not required; undici will set it automatically for Blob/ArrayBuffer
        'content-type': 'application/octet-stream',
      },
      body: blob, // could also be `arrayBuffer`, but Blob is broadly compatible
    });

    if (!uploadRes.ok) {
      const t = await uploadRes.text().catch(() => '');
      return jsonError(`Upload failed: ${uploadRes.status} ${t || uploadRes.statusText}`, 502);
    }

    const { upload_url } = (await uploadRes.json()) as { upload_url: string };
    if (!upload_url) return jsonError('Upload did not return upload_url', 502);

    // --- Create transcription job ---
    const createRes = await fetch('https://api.assemblyai.com/v2/transcribe', {
      method: 'POST',
      headers: {
        authorization: AAI_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        punctuate: true,
        format_text: true,
        disfluencies: false,
        speaker_labels: false,
        word_boost: [],
        language_detection: true,
      }),
    });

    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
      return jsonError(`Transcription create failed: ${createRes.status} ${t || createRes.statusText}`, 502);
    }

    const created = await createRes.json();
    const id: string | undefined = created?.id;
    if (!id) return jsonError('Transcription create did not return an id', 502);

    // --- Poll for completion ---
    let status = created?.status ?? 'queued';
    let result: any = null;

    for (let i = 0; i < 120; i++) {
      const getRes = await fetch(`https://api.assemblyai.com/v2/transcribe/${id}`, {
        headers: { authorization: AAI_KEY },
      });
      if (!getRes.ok) {
        const t = await getRes.text().catch(() => '');
        return jsonError(`Transcription get failed: ${getRes.status} ${t || getRes.statusText}`, 502);
      }
      result = await getRes.json();
      status = result?.status;
      if (status === 'completed') break;
      if (status === 'error') return jsonError(`Transcription error: ${result?.error || 'Unknown'}`, 502);
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (status !== 'completed') return jsonError(`Transcription not completed (status=${status})`, 504);

    // --- Normalize words to seconds ---
    const words: Word[] = (result?.words || [])
      .map((w: any) => ({
        text: String(w?.text ?? ''),
        start: Number(w?.start ?? 0) / 1000,
        end: Number(w?.end ?? 0) / 1000,
      }))
      .filter((w: Word) => isFinite(w.start) && isFinite(w.end) && w.end >= w.start);

    return NextResponse.json({
      text: result?.text ?? '',
      words,
      provider: 'assemblyai',
      language_code: result?.language_code ?? null,
    });
  } catch (err: any) {
    console.error('[api/transcribe] error:', err);
    return jsonError(err?.message || 'Unknown error', 500);
  }
}