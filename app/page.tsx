'use client';

import { useState, useEffect } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
import Image from 'next/image';

type Video = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
};

type SearchResponse = {
  videos: Video[];
  error?: string;
  upstreamStatus?: number;
  upstreamMessage?: string;
};

export default function Home() {
  const [query, setQuery] = useState('English practice');
  const [results, setResults] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data: SearchResponse = await res.json();
      if (data.error) {
        setError(data.upstreamMessage || data.error);
        setResults([]);
      } else {
        setResults(data.videos);
      }
    } catch {
      setError('Search failed. Please try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(query.trim());
  };

  useEffect(() => {
    search(query);
  }, []);

  const selectVideo = (video: Video) => {
    setSelected(video);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl md:text-4xl font-bold">English Video Practice</h1>
          <p className="mt-2 text-lg text-gray-600">
            Search a YouTube video, listen, read subtitles, and practise English.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter search keywords…"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-lg" role="alert">
            {error}
          </div>
        )}

        {results.length === 0 && !loading && (
          <p className="text-center text-gray-600">No videos found. Try another search.</p>
        )}

        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold">Results</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((video) => (
              <article
                key={video.id}
                onClick={() => selectVideo(video)}
                className="cursor-pointer bg-white rounded-lg shadow hover:shadow-lg transition p-3"
              >
                <img
                  src={video.thumbnail}
                  alt=""
                  className="w-full h-40 object-cover rounded mb-2"
                />
                <h3 className="font-medium line-clamp-2">{video.title}</h3>
                <p className="mt-1 text-sm text-gray-600 line-clamp-3">{video.description}</p>
              </article>
            ))}
          </div>
        </section>

        {selected && (
          <section>
            <h2 className="mb-2 text-xl font-semibold">Now playing: {selected.title}</h2>
            <VideoPlayer videoId={selected.id} />
          </section>
        )}
      </div>
    </div>
  );
}
