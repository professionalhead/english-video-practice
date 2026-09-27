import { NextRequest, NextResponse } from 'next/server';

type YouTubeSearchItem = {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    description?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
};

type YouTubeErrorResponse = {
  error?: {
    message?: string;
  };
};

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get('q')?.trim();

  if (!q) {
    return NextResponse.json({ error: 'Missing query' }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'YOUTUBE_API_KEY not set' },
      { status: 500 }
    );
  }

  const params = new URLSearchParams({
    part: 'snippet',
    maxResults: '10',
    q,
    type: 'video',
    key: apiKey,
  });

  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, { cache: 'no-store' });
    const data = (await res.json()) as { items?: YouTubeSearchItem[] } & YouTubeErrorResponse;

    if (!res.ok) {
      const upstreamMessage = data.error?.message ?? 'Unknown YouTube API error';
      console.error('YouTube API upstream error', {
        upstreamStatus: res.status,
        upstreamMessage,
      });
      return NextResponse.json(
        {
          error: 'YouTube API request failed',
          upstreamStatus: res.status,
          upstreamMessage,
        },
        { status: 502 }
      );
    }

    const videos = (data.items ?? [])
      .filter((video) => video.id?.videoId && video.snippet?.title)
      .map((video) => ({
        id: video.id!.videoId!,
        title: video.snippet!.title!,
        description: video.snippet!.description ?? '',
        thumbnail:
          video.snippet!.thumbnails?.high?.url ??
          video.snippet!.thumbnails?.medium?.url ??
          video.snippet!.thumbnails?.default?.url ??
          '',
      }));

    return NextResponse.json({ videos });
  } catch (error) {
    console.error('YouTube API request exception', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'YouTube API request failed' },
      { status: 502 }
    );
  }
}
