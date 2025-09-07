import { NextRequest, NextResponse } from 'next/server';

type Word = { text: string; start: number; end: number }; // seconds

/**
 * Provider: AssemblyAI (recommended)
 * - Set ASSEMBLYAI_API_KEY in your env (Vercel → Project → Settings → Environment Variables)
 * - We use their /v2/upload then /v2/transcribe with punctuate + word_boosts disabled.
 *
 * If you prefer Deepgram, see the commented section below.
 */

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get('audio') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'Missing audio file (field name: audio)' }, { status: 400 });
    }

    // Choose provider
    const AAI_KEY = process.env.ASSEMBLYAI_API_KEY;
    if (!AAI_KEY) {
      return NextResponse.json({ error: 'Server missing ASSEMBLYAI_API_KEY' }, { status: 500 });
    }

    // 1) Upload file to AssemblyAI’s temporary storage
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: AAI_KEY },
      body: file.stream(), // streams directly from the request
    });

    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      throw new Error(`Upload failed: ${uploadRes.status} ${t}`);
    }
    const { upload_url } = (await uploadRes.json()) as { upload_url: string };

    // 2) Request a transcription with words
    const transcribeRes = await fetch('https://api.assemblyai.com/v2/transcribe', {
      method: 'POST',
      headers: {
        authorization: AAI_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        // ensure we get word-level timestamps
        punctuate: true,
        format_text: true,
        word_boost: [],
        language_detection: true,
        disfluencies: false,
        speaker_labels: false,
        auto_chapters: false,
        // "words" come in the response body
      }),
    });

    if (!transcribeRes.ok) {
      const t = await transcribeRes.text();
      throw new Error(`Transcribe create failed: ${transcribeRes.status} ${t}`);
    }
    const created = await transcribeRes.json();

    // 3) Poll until completed
    let status = created.status as string;
    let id = created.id as string;
    let result: any = null;

    for (let i = 0; i < 120; i++) { // ~2 minutes max
      const getRes = await fetch(`https://api.assemblyai.com/v2/transcribe/${id}`, {
        headers: { authorization: AAI_KEY },
      });
      if (!getRes.ok) {
        const t = await getRes.text();
        throw new Error(`Transcribe get failed: ${getRes.status} ${t}`);
      }
      result = await getRes.json();
      status = result.status;
      if (status === 'completed' || status === 'error') break;
      await new Promise(r => setTimeout(r, 2000));
    }

    if (status !== 'completed') {
      throw new Error(`Transcription not completed (status=${status})`);
    }

    // 4) Normalize word list to seconds
    const words: Word[] = (result.words || []).map((w: any) => ({
      text: String(w.text || ''),
      start: Number(w.start || 0) / 1000,
      end: Number(w.end || 0) / 1000,
    })).filter((w: Word) => isFinite(w.start) && isFinite(w.end) && w.end >= w.start);

    return NextResponse.json({
      text: result.text ?? '',
      words,
      provider: 'assemblyai',
      language_code: result.language_code ?? null,
    });
  } catch (err: any) {
    console.error('[api/transcribe] error:', err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

/* ----------------- Deepgram alternative (comment) -----------------
If you prefer Deepgram, set DEEPGRAM_API_KEY and replace the logic above with:

  const DG_KEY = process.env.DEEPGRAM_API_KEY;
  if (!DG_KEY) ...
  const buf = Buffer.from(await file.arrayBuffer());
  const dgRes = await fetch('https://api.deepgram.com/v1/listen?smart_format=true&model=nova-2&language=en', {
    method: 'POST',
    headers: { Authorization: `Token ${DG_KEY}`, 'Content-Type': file.type || 'audio/mpeg' },
    body: buf,
  });
  const dg = await dgRes.json();
  // Extract words:
  const first = dg.results?.channels?.[0]?.alternatives?.[0];
  const words = (first?.words || []).map((w: any) => ({ text: w.word, start: w.start, end: w.end }));

------------------------------------------------------------------- */