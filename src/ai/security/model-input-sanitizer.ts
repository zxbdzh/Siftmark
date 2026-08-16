import type { AiRequestContext } from '../types';
import { redactSensitiveText } from './redact-sensitive';

export const MODEL_INPUT_LIMITS = {
  description: 500,
  pageText: 6_000,
  folderCandidates: 24,
  relatedBookmarks: 5
} as const;

export function sanitizeAiRequestContext(
  context: AiRequestContext
): AiRequestContext {
  const {
    title,
    url,
    currentFolderPath,
    description,
    pageText,
    additionalRules,
    availableFolderPaths,
    relatedBookmarks,
    ...rest
  } = context;
  return {
    ...rest,
    title: sanitizeModelText(title),
    url: redactUrlForModel(url),
    currentFolderPath: currentFolderPath.map((part) => sanitizeModelText(part)),
    ...(description !== undefined
      ? {
          description: sanitizeModelText(
            description,
            MODEL_INPUT_LIMITS.description
          )
        }
      : {}),
    ...(pageText !== undefined
      ? { pageText: sanitizeModelText(pageText, MODEL_INPUT_LIMITS.pageText) }
      : {}),
    ...(additionalRules !== undefined
      ? { additionalRules: sanitizeModelText(additionalRules) }
      : {}),
    ...(availableFolderPaths !== undefined
      ? {
          availableFolderPaths: availableFolderPaths
            .slice(0, MODEL_INPUT_LIMITS.folderCandidates)
            .map((path) => sanitizeModelText(path))
        }
      : {}),
    ...(relatedBookmarks !== undefined
      ? {
          relatedBookmarks: relatedBookmarks
            .slice(0, MODEL_INPUT_LIMITS.relatedBookmarks)
            .map((bookmark) => {
              const {
                title: bookmarkTitle,
                url: bookmarkUrl,
                summary,
                ...bookmarkRest
              } = bookmark;
              return {
                ...bookmarkRest,
                title: sanitizeModelText(bookmarkTitle),
                url: redactUrlForModel(bookmarkUrl),
                ...(summary !== undefined
                  ? {
                      summary: sanitizeModelText(
                        summary,
                        MODEL_INPUT_LIMITS.description
                      )
                    }
                  : {})
              };
            })
        }
      : {})
  };
}

export function sanitizeModelText(input: string, limit?: number): string {
  const redacted = redactSensitiveText(input);
  return limit === undefined
    ? redacted
    : Array.from(redacted).slice(0, limit).join('');
}

export function redactUrlForModel(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}
