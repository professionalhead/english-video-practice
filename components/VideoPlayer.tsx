'use client';

import { useEffect, useRef, useState } from 'react';
import YouTube from 'youtube-player';

interface TranscriptItem {
  text: string;
  duration: number;
  offset: number;
}

type TranscriptResponse = {
  transcript: TranscriptItem[];
} | {
  error: string;
};

export default function VideoPlayer({ videoId }: { videoId: string }) {
  const playerRef = useRef<HTMLDivElement>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize YouTube player
  useEffect(() => {
    if (!playerRef.current) return;

    const player = YouTube(playerRef.current, {
      width: 640,
      height: 360,
    });

    player.loadVideoById(videoId);

    const timer = setInterval(() => {
      player.getCurrentTime().then((t: number) => {
        const idx = transcript.findIndex(
          (item) => t >= item.offset && t < item.offset + item.duration
        );
        if (idx !== -1 && idx !== activeIdx) setActiveIdx(idx);
      });
    }, 500);

    return () => {
      clearInterval(timer);
      player.destroy();
    };
  }, [videoId, transcript]);

  // Fetch transcript with abort support
  useEffect(() => {
    if (!videoId) return;

    let cancelled = false;
    const controller = new AbortController();

    const fetchTranscript = async () => {
      setLoading(true);
      setError(null);
try {
        const res = await fetch(`/api/transcript?videoId=${videoId}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const message =
            (errData as { error?: string; message?: string })
              ?.message ?? 'Unknown error';
          throw new Error(`Transcript fetch failed: ${message}`);
        }

        const data = (await res.json()) as TranscriptResponse;
        if ('transcript' in data) {
          if (!cancelled) {
            setTranscript(data.transcript);
            setError(null);
          }
        } else {
          // unexpected shape
          throw new Error('Invalid transcript format');
        }
      } catch (e: unknown) {
        if ((e as any)?.name !== 'AbortError' && !cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : 'Unknown error loading transcript'
          );
          setTranscript([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchTranscript();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [videoId]);

  return (
    <div className="flex flex-col items-center">
      <div ref={playerRef} className="mb-4" />
      <div className="w-full max-w-2xl bg-gray-900 text-white p-2 rounded">
        {error ? (
          <span className="text-red-400">字幕載入失敗：{error}</span>
        ) : transcript.length > 0 ? (
          transcript.map((item, i) => (
            <span
              key={i}
              onClick={() => {
                const player = YouTube(playerRef.current!);
                player.seekTo(item.offset, true);
              }}
              className={`cursor-pointer px-1 mr-1 ${
                i === activeIdx ? 'bg-yellow-400 text-black' : ''
              }`}
            >
              {item.text}
            </span>
          ))
        ) : (
          <span>載入字幕中…</span>
        )}
      </div>
    </div>
  );
}