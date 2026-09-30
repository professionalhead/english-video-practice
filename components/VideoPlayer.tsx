'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import YouTube from 'youtube-player';
import { InteractiveWord } from './InteractiveWord';

interface TranscriptItem {
  text: string;
  duration: number;
  offset: number;
  translation?: string;
}

interface TranscriptResponse {
  transcript?: TranscriptItem[];
  sourceLanguage?: string | null;
  requestedLanguage?: string;
  attemptsTried?: string[];
  error?: string;
  message?: string;
}

type DisplayMode = 'source' | 'bilingual' | 'zh-TW';

type SourceLanguage =
  | 'en'
  | 'ja'
  | 'ko'
  | 'zh-TW'
  | 'zh-CN'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'ru'
  | 'uk'
  | 'ar'
  | 'hi'
  | 'th'
  | 'vi'
  | 'id'
  | 'tr'
  | 'nl'
  | 'pl';

interface CacheData {
  version: number;
  videoId: string;
  sourceLanguage: SourceLanguage;
  targetLanguage: 'zh-TW';
  sourceCount: number;
  sourceFingerprint: string;
  translations: Array<string | null>;
  savedAt: number;
}

interface TranslationRequestItem {
  index: number;
  text: string;
}

interface TranslationResponse {
  translations?: Array<{
    index: number;
    translation: string;
  }>;
  error?: string;
  message?: string;
}

interface YouTubePlayerLike {
  loadVideoById: (videoId: string) => Promise<void> | void;
  getCurrentTime: () => Promise<number> | number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => Promise<void> | void;
  playVideo: () => Promise<void> | void;
  destroy: () => Promise<void> | void;
  on: (event: string, handler: (event: { data?: number }) => void) => void;
  removeEventListener?: (
    event: string,
    handler: (event: { data?: number }) => void
  ) => void;
}

const CACHE_VERSION = 2;
const TARGET_LANGUAGE = 'zh-TW';
const CACHE_KEY_PREFIX = 'english-video-practice-translations:v2';
const BATCH_SIZE = 10;

const SOURCE_LANGUAGE_OPTIONS: Array<{
  value: SourceLanguage;
  label: string;
}> = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'uk', label: 'Українська' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getCacheKey(videoId: string, sourceLanguage: SourceLanguage): string {
  return `${CACHE_KEY_PREFIX}:${videoId}:${sourceLanguage}:${TARGET_LANGUAGE}`;
}

function createTranscriptFingerprint(items: TranscriptItem[]): string {
  return items.map((item) => item.text.slice(0, 200)).join('|');
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

function findActiveIndex(items: TranscriptItem[], current: number): number {
  if (items.length === 0 || !Number.isFinite(current) || current < items[0].offset) {
    return -1;
  }

  let low = 0;
  let high = items.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (items[middle].offset <= current) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
}

function splitIntoBatches(indices: number[], batchSize: number): number[][] {
  const batches: number[][] = [];

  for (let i = 0; i < indices.length; i += batchSize) {
    batches.push(indices.slice(i, i + batchSize));
  }

  return batches;
}

function parseCache(raw: string | null): CacheData | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CacheData>;

    if (
      parsed.version !== CACHE_VERSION ||
      typeof parsed.videoId !== 'string' ||
      typeof parsed.sourceLanguage !== 'string' ||
      parsed.targetLanguage !== TARGET_LANGUAGE ||
      typeof parsed.sourceCount !== 'number' ||
      typeof parsed.sourceFingerprint !== 'string' ||
      !Array.isArray(parsed.translations) ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null;
    }

    return {
      version: CACHE_VERSION,
      videoId: parsed.videoId,
      sourceLanguage: parsed.sourceLanguage as SourceLanguage,
      targetLanguage: TARGET_LANGUAGE,
      sourceCount: parsed.sourceCount,
      sourceFingerprint: parsed.sourceFingerprint,
      translations: parsed.translations.map((value) =>
        typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
      ),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function safeSetCache(key: string, data: CacheData): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i += 1) {
        const itemKey = localStorage.key(i);
        if (itemKey && itemKey.startsWith(CACHE_KEY_PREFIX)) {
          keysToRemove.push(itemKey);
        }
      }

      keysToRemove.forEach((itemKey) => localStorage.removeItem(itemKey));
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // ignore
    }
  }
}

function renderInteractiveText(text: string) {
  return text.split(/(\s+)/).map((part, index) => {
    if (/^\s+$/.test(part)) {
      return <span key={`space-${index}`}>{part}</span>;
    }

    return <InteractiveWord key={`word-${index}-${part}`} rawWord={part} />;
  });
}

export default function VideoPlayer({ videoId }: { videoId: string }) {
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const activeTranscriptRef = useRef<HTMLDivElement | null>(null);
  const playerInstanceRef = useRef<YouTubePlayerLike | null>(null);

  const transcriptRef = useRef<TranscriptItem[]>([]);
  const activeTranslationKeyRef = useRef<string | null>(null);
  const isSeekingRef = useRef(false);

  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [, setCandidateIdx] = useState(-1);
  const [, setCurrentTime] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [displayMode, setDisplayMode] = useState<DisplayMode>('bilingual');
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('en');
  const [resolvedSourceLanguage, setResolvedSourceLanguage] = useState<string | null>(null);

  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    const element = playerContainerRef.current;
    if (!element) return;

    let disposed = false;

    const player = YouTube(element, {
      width: 960,
      height: 540,
      playerVars: {
        playsinline: 1,
        rel: 0,
      },
    }) as unknown as YouTubePlayerLike;

    playerInstanceRef.current = player;
    void player.loadVideoById(videoId);

    const handleError = (event: { data?: number }) => {
      if (disposed) return;
      const code = typeof event.data === 'number' ? event.data : -1;
      setPlayerError(`影片無法播放（YouTube error ${code}）`);
    };

    player.on('error', handleError);

    return () => {
      disposed = true;

      if (typeof player.removeEventListener === 'function') {
        player.removeEventListener('error', handleError);
      }

      void player.destroy();

      if (playerInstanceRef.current === player) {
        playerInstanceRef.current = null;
      }
    };
  }, [videoId]);

  useEffect(() => {
    if (!videoId) return;

    let cancelled = false;
    activeTranslationKeyRef.current = null;

    const fetchTranscript = async () => {
      setLoading(true);
      setError(null);
      setPlayerError(null);
      setTranscript([]);
      setActiveIdx(-1);
      setCandidateIdx(-1);
      setCurrentTime(0);
      setTranslationLoading(false);
      setTranslationError(null);
      setResolvedSourceLanguage(null);

      try {
        const res = await fetch(
          `/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(
            sourceLanguage
          )}`
        );

        const data = (await res.json().catch(() => null)) as TranscriptResponse | null;

        if (!res.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Transcript fetch failed: ${sourceLanguage}`
          );
        }

        if (!data?.transcript || !Array.isArray(data.transcript)) {
          throw new Error('Invalid transcript format');
        }

        const normalized: TranscriptItem[] = data.transcript
          .map((item) => ({
            text: String(item.text ?? '').trim(),
            offset: Number(item.offset),
            duration: Number(item.duration),
            translation: undefined,
          }))
          .filter(
            (item) =>
              item.text.length > 0 &&
              Number.isFinite(item.offset) &&
              Number.isFinite(item.duration)
          )
          .sort((a, b) => a.offset - b.offset);

        if (cancelled) return;

        setTranscript(normalized);
        setResolvedSourceLanguage(data.sourceLanguage ?? data.requestedLanguage ?? sourceLanguage);
        setError(null);
      } catch (fetchError: unknown) {
        if (cancelled) return;
        setError(toErrorMessage(fetchError, 'Unknown error loading transcript'));
        setTranscript([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchTranscript();

    return () => {
      cancelled = true;
    };
  }, [videoId, sourceLanguage]);

  const hasTranscript = transcript.length > 0;

  useEffect(() => {
    if (!videoId || !hasTranscript) return;

    if (displayMode === 'source') {
      activeTranslationKeyRef.current = null;
      setTranslationLoading(false);
      setTranslationError(null);
      return;
    }

    const currentTranscript = transcriptRef.current;
    if (currentTranscript.length === 0) return;

    const sourceFingerprint = createTranscriptFingerprint(currentTranscript);
    const translationKey = `${videoId}:${sourceLanguage}:${TARGET_LANGUAGE}:${sourceFingerprint}`;
    const cacheKey = getCacheKey(videoId, sourceLanguage);

    if (activeTranslationKeyRef.current === translationKey) return;
    activeTranslationKeyRef.current = translationKey;

    const startTranslationTask = async () => {
      setTranslationLoading(true);
      setTranslationError(null);

      let cached: CacheData | null = null;

      try {
        cached = parseCache(localStorage.getItem(cacheKey));
      } catch {
        cached = null;
      }

      const cacheMatches =
        !!cached &&
        cached.videoId === videoId &&
        cached.sourceLanguage === sourceLanguage &&
        cached.targetLanguage === TARGET_LANGUAGE &&
        cached.sourceCount === currentTranscript.length &&
        cached.sourceFingerprint === sourceFingerprint &&
        cached.translations.length === currentTranscript.length;

      const translated: Array<string | null> = cacheMatches
              ? [...cached!.translations]
              : new Array(currentTranscript.length).fill(null);

      if (cacheMatches) {
        setTranscript((prev) =>
          prev.map((item, idx) => ({
            ...item,
            translation: translated[idx] ?? item.translation,
          }))
        );
      }

      const missingIndices = currentTranscript
        .map((_, idx) => idx)
        .filter((idx) => {
          const value = translated[idx];
          return !(typeof value === 'string' && value.trim().length > 0);
        });

      if (missingIndices.length === 0) {
        setTranslationLoading(false);
        setTranslationError(null);
        return;
      }

      const batches = splitIntoBatches(missingIndices, BATCH_SIZE);
      const total = currentTranscript.length;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        if (activeTranslationKeyRef.current !== translationKey) return;

        const batch = batches[batchIndex];
        const latestTranscript = transcriptRef.current;

        const items: TranslationRequestItem[] = batch.map((idx) => ({
          index: idx,
          text: latestTranscript[idx]?.text ?? '',
        }));

        let success = false;
        let retries = 3;

        while (retries > 0 && !success) {
          if (activeTranslationKeyRef.current !== translationKey) return;

          try {
            const response = await fetch('/api/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                videoId,
                items,
                targetLanguage: TARGET_LANGUAGE,
              }),
            });

            const responseJson =
              (await response.json().catch(() => null)) as TranslationResponse | null;

            if (!response.ok) {
              throw new Error(
                responseJson?.error ??
                  responseJson?.message ??
                  `Translation request failed with status ${response.status}`
              );
            }

            if (!Array.isArray(responseJson?.translations)) {
              throw new Error('Invalid translation response format');
            }

            for (const entry of responseJson.translations) {
              if (
                typeof entry.index === 'number' &&
                entry.index >= 0 &&
                entry.index < total &&
                typeof entry.translation === 'string'
              ) {
                translated[entry.index] = entry.translation.trim();
              }
            }

            success = true;
          } catch (batchError: unknown) {
            retries -= 1;

            if (retries > 0) {
              await delay(1200);
            } else {
              setTranslationError(
                toErrorMessage(batchError, 'Translation batch failed')
              );
            }
          }
        }

        if (activeTranslationKeyRef.current !== translationKey) return;

        setTranscript((prev) =>
          prev.map((item, idx) => ({
            ...item,
            translation: translated[idx] ?? item.translation,
          }))
        );

        safeSetCache(cacheKey, {
          version: CACHE_VERSION,
          videoId,
          sourceLanguage,
          targetLanguage: TARGET_LANGUAGE,
          sourceCount: total,
          sourceFingerprint,
          translations: translated,
          savedAt: Date.now(),
        });

        await delay(300);
      }

      if (activeTranslationKeyRef.current !== translationKey) return;

      setTranslationLoading(false);
      setTranslationError(null);
    };

    void startTranslationTask();
  }, [videoId, sourceLanguage, displayMode, hasTranscript]);

  useEffect(() => {
    if (transcript.length === 0) {
      setActiveIdx(-1);
      setCandidateIdx(-1);
      setCurrentTime(0);
      return;
    }

    let disposed = false;
    let polling = false;

    const updateActive = async () => {
      if (disposed || polling || isSeekingRef.current) return;

      const player = playerInstanceRef.current;
      if (!player) return;

      polling = true;

      try {
        const rawTime = await player.getCurrentTime();
        const current = Number(rawTime);

        if (!Number.isFinite(current)) return;

        const index = findActiveIndex(transcriptRef.current, current);

        if (!disposed && !isSeekingRef.current) {
          setCurrentTime(current);
          setCandidateIdx(index);
          setActiveIdx((previous) => (previous === index ? previous : index));
        }
      } finally {
        polling = false;
      }
    };

    void updateActive();

    const intervalId = window.setInterval(() => {
      void updateActive();
    }, 200);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [transcript]);

  useLayoutEffect(() => {
    if (activeIdx < 0) return;

    const container = transcriptContainerRef.current;
    const activeElement = activeTranscriptRef.current;

    if (!container || !activeElement) return;

    container.scrollTo({
      top: Math.max(activeElement.offsetTop, 0),
      behavior: 'auto',
    });
  }, [activeIdx]);

  const handleSubtitleDoubleClick = async (index: number) => {
    const item = transcript[index];
    const player = playerInstanceRef.current;

    if (!item || !player || !Number.isFinite(item.offset)) return;

    isSeekingRef.current = true;

    try {
      setCurrentTime(item.offset);
      setCandidateIdx(index);
      setActiveIdx(index);

      await player.seekTo(item.offset, true);
      await player.playVideo();
    } catch (seekError: unknown) {
      console.error('Failed to seek subtitle', {
        index,
        message: toErrorMessage(seekError, 'Unknown error'),
      });
    } finally {
      window.setTimeout(() => {
        isSeekingRef.current = false;
      }, 500);
    }
  };

  const sourceLanguageLabel = useMemo(() => {
    const match = SOURCE_LANGUAGE_OPTIONS.find((item) => item.value === sourceLanguage);
    return match?.label ?? sourceLanguage;
  }, [sourceLanguage]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4">
      <div
        ref={playerContainerRef}
        className="mb-5 aspect-video w-full max-w-5xl overflow-hidden rounded-2xl bg-black shadow-xl"
      />

      <div className="mb-3 flex w-full max-w-5xl flex-wrap items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3">
        <label htmlFor="source-language" className="text-xs font-medium text-slate-400">
          原文字幕
        </label>

        <select
          id="source-language"
          value={sourceLanguage}
          onChange={(e) => setSourceLanguage(e.target.value as SourceLanguage)}
          className="min-w-[220px] rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-amber-300"
        >
          {SOURCE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="rounded-full bg-slate-800 px-2 py-1">
            目前原文字幕：
            <span className="ml-1 font-semibold text-amber-300">{sourceLanguageLabel}</span>
          </span>

          <span className="rounded-full bg-slate-800 px-2 py-1">
            實際抓到：
            <span className="ml-1 font-semibold text-sky-300">
              {resolvedSourceLanguage ?? '—'}
            </span>
          </span>
        </div>
      </div>

      <div className="mb-4 flex w-full max-w-5xl flex-wrap items-center justify-center gap-2">
        <span className="text-xs font-medium text-slate-400">顯示模式：</span>

        <button
          type="button"
          onClick={() => setDisplayMode('source')}
          className={`rounded px-3 py-1 text-sm transition ${
            displayMode === 'source'
              ? 'bg-amber-300 text-slate-950'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          原文
        </button>

        <button
          type="button"
          onClick={() => setDisplayMode('bilingual')}
          className={`rounded px-3 py-1 text-sm transition ${
            displayMode === 'bilingual'
              ? 'bg-amber-300 text-slate-950'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          原文 + 中文
        </button>

        <button
          type="button"
          onClick={() => setDisplayMode('zh-TW')}
          className={`rounded px-3 py-1 text-sm transition ${
            displayMode === 'zh-TW'
              ? 'bg-amber-300 text-slate-950'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          中文
        </button>
      </div>

      {playerError ? (
        <div className="mb-4 w-full max-w-5xl rounded bg-red-100 p-3 text-red-800">
          {playerError}
        </div>
      ) : null}

      {translationError && displayMode !== 'source' ? (
        <div className="mb-4 w-full max-w-5xl rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {translationError}
        </div>
      ) : null}

      {loading ? <div className="py-4 text-center">載入字幕中...</div> : null}
      {error && !loading ? (
        <div className="py-4 text-center text-red-400">{error}</div>
      ) : null}
      {!loading && !error && transcript.length === 0 ? (
        <div className="py-4 text-center">找不到字幕</div>
      ) : null}

      <div
        ref={transcriptContainerRef}
        className="relative h-[420px] w-full max-w-5xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-950"
      >
        {transcript.map((item, i) => {
          const isActive = i === activeIdx;

          return (
            <div
              key={`${videoId}-${sourceLanguage}-${i}-${item.offset}`}
              ref={isActive ? activeTranscriptRef : null}
              onDoubleClick={() => void handleSubtitleDoubleClick(i)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSubtitleDoubleClick(i);
                }
              }}
              role="button"
              tabIndex={0}
              title={item.text}
              aria-label={`雙擊跳轉到字幕第 ${i + 1} 句`}
              className={`block cursor-pointer select-none px-3 py-2 transition-colors ${
                isActive
                  ? 'sticky top-0 z-20 rounded-none bg-amber-300 font-semibold text-slate-950 shadow-[0_8px_28px_rgba(251,191,36,0.45)]'
                  : 'relative z-0 rounded text-slate-300 hover:bg-slate-800'
              }`}
            >
              {(displayMode === 'source' || displayMode === 'bilingual') && (
                <div className="block text-base leading-relaxed">
                  {renderInteractiveText(item.text)}
                </div>
              )}

              {(displayMode === 'zh-TW' || displayMode === 'bilingual') && (
                <div
                  lang="zh-Hant"
                  className={
                    displayMode === 'bilingual'
                      ? 'mt-1 block text-sm leading-relaxed opacity-75'
                      : 'block text-base leading-relaxed'
                  }
                >
                  {item.translation ?? (translationLoading ? '翻譯中…' : '')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}