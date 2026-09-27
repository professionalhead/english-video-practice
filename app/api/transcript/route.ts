import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get('videoId');
  if (!videoId) return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });

  try {
    const data = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'Transcript not found' }, { status: 404 });
  }
}