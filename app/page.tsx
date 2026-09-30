'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
    const trimmed = query.trim();
    if (!trimmed) return;
    void search(trimmed);
  };

  useEffect(() => {
    void search(query);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-4 text-gray-900 md:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-3xl font-bold md:text-4xl">English Video Practice</h1>
          <p className="mt-2 text-lg text-gray-600">
            Search a YouTube video, then open a dedicated study page to watch,
            read subtitles, and practise English.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter search keywords…"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && (
          <div className="mb-4 rounded-lg bg-red-100 p-3 text-red-800" role="alert">
            {error}
          </div>
        )}

        {results.length === 0 && !loading && (
          <p className="text-center text-gray-600">
            No videos found. Try another search.
          </p>
        )}

        <section className="mb-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Results</h2>
            <span className="text-sm text-gray-500">
              {loading ? 'Searching…' : `${results.length} result(s)`}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((video) => (
              <Link
                key={video.id}
                href={`/watch/${video.id}`}
                className="block rounded-lg bg-white p-3 shadow transition hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="mb-2 h-40 w-full rounded object-cover"
                  loading="lazy"
                />
                <h3 className="line-clamp-2 font-medium">{video.title}</h3>
                <p className="mt-1 line-clamp-3 text-sm text-gray-600">
                  {video.description}
                </p>
                <div className="mt-3 inline-flex items-center rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700">
                  Open study page →
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}