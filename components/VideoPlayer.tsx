'use client';

import { useEffect, useRef, useState } from 'react';
import YouTube from 'youtube-player';

interface TranscriptItem {
  start: number;
  duration: number;
  text: string;
}

export default function VideoPlayer({ videoId }: { videoId: string }) {
  const playerRef = useRef<HTMLDivElement>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

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
          (item) => t >= item.start && t < item.start + item.duration
        );
        if (idx !== -1 && idx !== activeIdx) setActiveIdx(idx);
      });
    }, 500);

    return () => {
      clearInterval(timer);
      player.destroy();
    };
  }, [videoId, transcript]);

  // Fetch transcript
  useEffect(() => {
    fetch(`/api/transcript?videoId=${videoId}`)
      .then((r) => r.json())
      .then(setTranscript)
      .catch(console.error);
  }, [videoId]);

  return (
    <div className="flex flex-col items-center">
      <div ref={playerRef} className="mb-4" />
      <div className="w-full max-w-2xl bg-gray-900 text-white p-2 rounded">
        {transcript.length > 0 ? (
          transcript.map((item, i) => (
            <span
              key={i}
              onClick={() => {
                const player = YouTube(playerRef.current!);
                player.seekTo(item.start, true);
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