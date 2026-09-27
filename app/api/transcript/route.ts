import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get('videoId');
  if (!videoId) {
    return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
  }

  try {
    const data = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });

    // Transform to unified format
    const transcript = Array.isArray(data)
      ? data.map((item) => ({
          text: item.text,
          duration: item.duration,
          offset: item.offset,
        }))
      : [];

    if (transcript.length === 0) {
      return NextResponse.json(
        { error: 'Transcript not available', message: 'No transcript data returned' },
        { status: 404 }
      );
    }

    return NextResponse.json({ transcript });
  } catch (error) {
    console.error('Transcript fetch failed', {
      videoId,
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Transcript not available', message: 'Failed to fetch transcript' },
      { status: 404 }
    );
  }
}