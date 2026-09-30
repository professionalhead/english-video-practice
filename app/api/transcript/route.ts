import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';

const PROVIDER_NAME = 'youtube-transcript';
const IS_PRODUCTION = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

function classifyError(message: string): string {
  const msg = message.toLowerCase();
  if (msg.includes('requested language') || msg.includes('language not available') || msg.includes('no transcript') || msg.includes('not available')) {
    return 'LANGUAGE_UNAVAILABLE';
  }
  if (msg.includes('transcript disabled') || msg.includes('captions are disabled') || msg.includes('no captions')) {
    return 'NO_CAPTIONS';
  }
  if (msg.includes('blocked') || msg.includes('429') || msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('ip blocked')) {
    return 'IP_BLOCKED';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('eai_again')) {
    return 'REQUEST_BLOCKED';
  }
  return 'TRANSCRIPT_PROVIDER_ERROR';
}

type FetchError = {
  attempt: string;
  message: string;
  errorCode?: string;
  provider?: string;
  environment?: string;
  videoId?: string;
  requestedLanguage?: string;
};

type RawTranscriptItem = {
  text?: unknown;
  offset?: unknown;
  duration?: unknown;
};

type NormalizedTranscriptItem = {
  text: string;
  offset: number;
  duration: number;
};

const MAX_GAP_SECONDS = 1.2;
const MAX_MERGED_DURATION_SECONDS = 12;
const MAX_MERGED_TEXT_LENGTH = 220;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeTranscript(data: unknown): NormalizedTranscriptItem[] {
  return Array.isArray(data)
    ? data
        .map((item) => {
          const row = item as RawTranscriptItem;

          return {
            text: normalizeText(String(row?.text ?? '')),
            offset: Number(row?.offset) / 1000,
            duration: Number(row?.duration) / 1000,
          };
        })
        .filter(
          (item) =>
            item.text.length > 0 &&
            Number.isFinite(item.offset) &&
            Number.isFinite(item.duration)
        )
        .sort((a, b) => a.offset - b.offset)
    : [];
}

function endsSentence(text: string): boolean {
  return /[.!?。！？]["')\]]?$/.test(text.trim());
}

function startsLikelyNewSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  return /^[A-Z\u3040-\u30ff\u3400-\u9fff"'(\[]/.test(trimmed);
}

function shouldMerge(
  current: NormalizedTranscriptItem,
  next: NormalizedTranscriptItem
): boolean {
  const currentText = current.text.trim();
  const nextText = next.text.trim();

  if (!currentText || !nextText) return false;

  const currentEnd = current.offset + current.duration;
  const gap = next.offset - currentEnd;
  const mergedDuration = next.offset + next.duration - current.offset;
  const mergedTextLength = `${currentText} ${nextText}`.length;

  if (gap > MAX_GAP_SECONDS) return false;
  if (mergedDuration > MAX_MERGED_DURATION_SECONDS) return false;
  if (mergedTextLength > MAX_MERGED_TEXT_LENGTH) return false;

  if (endsSentence(currentText)) return false;

  if (/^[,.;:!?、。)]/.test(nextText)) return true;

  if (
    /^(and|but|or|so|because|that|which|who|when|while|if|then|than|to|of|for|with|in|on|at|from|as|by)\b/i.test(
      nextText
    )
  ) {
    return true;
  }

  if (
    /^(is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|may|might)\b/i.test(
      nextText
    )
  ) {
    return true;
  }

  if (
    /^(a|an|the|my|your|his|her|its|our|their|this|that|these|those)\b/i.test(
      nextText
    )
  ) {
    return true;
  }

  if (!startsLikelyNewSentence(nextText)) return true;

  if (currentText.length < 45) return true;

  return false;
}

function mergeTranscriptSegments(
  items: NormalizedTranscriptItem[]
): NormalizedTranscriptItem[] {
  if (items.length <= 1) return items;

  const merged: NormalizedTranscriptItem[] = [];
  let current = { ...items[0] };

  for (let i = 1; i < items.length; i += 1) {
    const next = items[i];

    if (shouldMerge(current, next)) {
      const joinedText =
        /^[,.;:!?、。)]/.test(next.text)
          ? `${current.text}${next.text}`
          : `${current.text} ${next.text}`;

      const endTime = Math.max(
        current.offset + current.duration,
        next.offset + next.duration
      );

      current = {
        text: normalizeText(joinedText),
        offset: current.offset,
        duration: endTime - current.offset,
      };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

function normalizeLangTag(input: string | null): string {
  return (input || 'en').trim();
}

function dedupeList(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    result.push(key);
  }

  return result;
}

function buildLanguageAttempts(lang: string): string[] {
  const normalized = normalizeLangTag(lang);
  const lower = normalized.toLowerCase();

  const presets: Record<string, string[]> = {
    en: ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU'],
    'en-us': ['en-US', 'en', 'en-GB', 'en-CA', 'en-AU'],
    'en-gb': ['en-GB', 'en', 'en-US', 'en-CA', 'en-AU'],
    'en-ca': ['en-CA', 'en', 'en-US', 'en-GB'],
    'en-au': ['en-AU', 'en', 'en-GB', 'en-US'],

    ja: ['ja', 'ja-JP'],
    'ja-jp': ['ja-JP', 'ja'],

    ko: ['ko', 'ko-KR'],
    'ko-kr': ['ko-KR', 'ko'],

    zh: ['zh', 'zh-TW', 'zh-Hant', 'zh-Hant-TW', 'zh-CN', 'zh-Hans', 'zh-Hans-CN'],
    'zh-tw': ['zh-TW', 'zh-Hant', 'zh-Hant-TW', 'zh'],
    'zh-hant': ['zh-Hant', 'zh-TW', 'zh-Hant-TW', 'zh'],
    'zh-hant-tw': ['zh-Hant-TW', 'zh-Hant', 'zh-TW', 'zh'],
    'zh-cn': ['zh-CN', 'zh-Hans', 'zh-Hans-CN', 'zh'],
    'zh-hans': ['zh-Hans', 'zh-CN', 'zh-Hans-CN', 'zh'],
    'zh-hans-cn': ['zh-Hans-CN', 'zh-Hans', 'zh-CN', 'zh'],

    es: ['es', 'es-ES', 'es-419', 'es-MX'],
    'es-es': ['es-ES', 'es', 'es-419', 'es-MX'],
    'es-419': ['es-419', 'es', 'es-ES', 'es-MX'],
    'es-mx': ['es-MX', 'es-419', 'es', 'es-ES'],

    pt: ['pt', 'pt-BR', 'pt-PT'],
    'pt-br': ['pt-BR', 'pt', 'pt-PT'],
    'pt-pt': ['pt-PT', 'pt', 'pt-BR'],

    fr: ['fr', 'fr-FR', 'fr-CA'],
    'fr-fr': ['fr-FR', 'fr', 'fr-CA'],
    'fr-ca': ['fr-CA', 'fr', 'fr-FR'],

    de: ['de', 'de-DE'],
    'de-de': ['de-DE', 'de'],

    it: ['it', 'it-IT'],
    'it-it': ['it-IT', 'it'],

    ru: ['ru', 'ru-RU'],
    'ru-ru': ['ru-RU', 'ru'],

    ar: ['ar', 'ar-SA', 'ar-EG'],
    'ar-sa': ['ar-SA', 'ar', 'ar-EG'],
    'ar-eg': ['ar-EG', 'ar', 'ar-SA'],

    hi: ['hi', 'hi-IN'],
    'hi-in': ['hi-IN', 'hi'],

    id: ['id', 'id-ID'],
    'id-id': ['id-ID', 'id'],

    vi: ['vi', 'vi-VN'],
    'vi-vn': ['vi-VN', 'vi'],

    th: ['th', 'th-TH'],
    'th-th': ['th-TH', 'th'],

    tr: ['tr', 'tr-TR'],
    'tr-tr': ['tr-TR', 'tr'],

    nl: ['nl', 'nl-NL'],
    'nl-nl': ['nl-NL', 'nl'],

    pl: ['pl', 'pl-PL'],
    'pl-pl': ['pl-PL', 'pl'],

    sv: ['sv', 'sv-SE'],
    'sv-se': ['sv-SE', 'sv'],

    no: ['no', 'nb', 'nn', 'no-NO'],
    'no-no': ['no-NO', 'no', 'nb', 'nn'],
    nb: ['nb', 'no', 'no-NO'],
    nn: ['nn', 'no', 'no-NO'],

    da: ['da', 'da-DK'],
    'da-dk': ['da-DK', 'da'],

    fi: ['fi', 'fi-FI'],
    'fi-fi': ['fi-FI', 'fi'],

    cs: ['cs', 'cs-CZ'],
    'cs-cz': ['cs-CZ', 'cs'],

    sk: ['sk', 'sk-SK'],
    'sk-sk': ['sk-SK', 'sk'],

    hu: ['hu', 'hu-HU'],
    'hu-hu': ['hu-HU', 'hu'],

    ro: ['ro', 'ro-RO'],
    'ro-ro': ['ro-RO', 'ro'],

    bg: ['bg', 'bg-BG'],
    'bg-bg': ['bg-BG', 'bg'],

    uk: ['uk', 'uk-UA'],
    'uk-ua': ['uk-UA', 'uk'],

    el: ['el', 'el-GR'],
    'el-gr': ['el-GR', 'el'],

    he: ['he', 'he-IL'],
    'he-il': ['he-IL', 'he'],

    fa: ['fa', 'fa-IR'],
    'fa-ir': ['fa-IR', 'fa'],

    ur: ['ur', 'ur-PK'],
    'ur-pk': ['ur-PK', 'ur'],

    ms: ['ms', 'ms-MY'],
    'ms-my': ['ms-MY', 'ms'],

    tl: ['tl', 'fil', 'tl-PH', 'fil-PH'],
    fil: ['fil', 'tl', 'fil-PH', 'tl-PH'],
    'tl-ph': ['tl-PH', 'tl', 'fil-PH', 'fil'],
    'fil-ph': ['fil-PH', 'fil', 'tl-PH', 'tl'],
  };

  const exactPreset = presets[lower];
  if (exactPreset) {
    return dedupeList([...exactPreset, 'default']);
  }

  const parts = normalized.split('-').filter(Boolean);
  const base = parts[0] || normalized;

  const attempts = [
    normalized,
    base,
    `${base}-${base.toUpperCase()}`,
    'default',
  ];

  return dedupeList(attempts);
}

async function tryFetchTranscript(videoId: string, lang: string): Promise<{
    transcript: NormalizedTranscriptItem[];
    sourceLanguage: string | null;
    requestedLanguage: string;
    attemptsTried: string[];
    errors: FetchError[];
}> {
  const languageAttempts = buildLanguageAttempts(lang);

  const attempts: Array<{
    label: string;
    run: () => Promise<unknown>;
  }> = languageAttempts.map((attemptLang) => {
    if (attemptLang === 'default') {
      return {
        label: 'default',
        run: () => YoutubeTranscript.fetchTranscript(videoId),
      };
    }

    return {
      label: attemptLang,
      run: () => YoutubeTranscript.fetchTranscript(videoId, { lang: attemptLang }),
    };
  });

  const errors: FetchError[] = [];

  for (const attempt of attempts) {
    try {
      const data = await attempt.run();
      const transcript = normalizeTranscript(data);

      if (transcript.length > 0) {
        return {
          transcript,
          sourceLanguage: attempt.label,
          requestedLanguage: lang,
          attemptsTried: languageAttempts,
          errors,
        };
      }

      errors.push({
        attempt: attempt.label,
        message: 'No transcript data returned',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = classifyError(message);
      errors.push({
        attempt: attempt.label,
        message,
        errorCode,
        provider: PROVIDER_NAME,
        environment: IS_PRODUCTION ? 'production' : 'local',
        videoId,
        requestedLanguage: lang,
      });
    }
  }

  return {
    transcript: [],
    sourceLanguage: null as string | null,
    requestedLanguage: lang,
    attemptsTried: languageAttempts,
    errors,
  };
}

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get('videoId');
  const lang = normalizeLangTag(req.nextUrl.searchParams.get('lang'));

  if (!videoId) {
    return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
  }

  try {
    const result = await tryFetchTranscript(videoId, lang);

    if (result.transcript.length === 0) {
      console.error('Transcript fetch failed', {
        videoId,
        requestedLanguage: lang,
        attemptsTried: result.attemptsTried,
        attempts: result.errors,
      });

      return NextResponse.json(
        {
          error: 'Transcript not available',
          errorCode: 'LANGUAGE_UNAVAILABLE',
          message: `No transcript could be fetched for requested language: ${lang}`,
          requestedLanguage: lang,
          attemptsTried: result.attemptsTried,
          attempts: result.errors,
        },
        { status: 404 }
      );
    }

    const mergedTranscript = mergeTranscriptSegments(result.transcript);

    return NextResponse.json({
      transcript: mergedTranscript,
      sourceLanguage: result.sourceLanguage,
      requestedLanguage: result.requestedLanguage,
      attemptsTried: result.attemptsTried,
      meta: {
        originalSegmentCount: result.transcript.length,
        mergedSegmentCount: mergedTranscript.length,
        merged: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = classifyError(message);
    console.error('Transcript fetch failed', {
      videoId,
      requestedLanguage: lang,
      message,
      errorCode,
      provider: PROVIDER_NAME,
      environment: IS_PRODUCTION ? 'production' : 'local',
    });

    return NextResponse.json(
      {
        error: 'Transcript not available',
        errorCode,
        message: 'Failed to fetch transcript',
        requestedLanguage: lang,
      },
      { status: 404 }
    );
  }
}