const MAX_RELATED_BOOKMARKS = 5;
const MAX_CANDIDATE_PATHS = 12;
const MAX_PAGE_TEXT_LENGTH = 6_000;
const MAX_SUMMARY_LENGTH = 500;

export interface CaptureContextCandidate {
  folderId: string;
  path: string[];
}

export interface CaptureContextRelatedBookmark {
  id: string;
  title: string;
  url: string;
  summary: string;
}

export interface CaptureModelContextInput {
  title: string;
  url: string;
  description?: string;
  pageText?: string;
  candidateFolders: CaptureContextCandidate[];
  relatedBookmarks: CaptureContextRelatedBookmark[];
}

export interface CaptureModelContext {
  currentPage: {
    title: string;
    url: string;
    description?: string;
    pageText?: string;
  };
  candidateFolders: CaptureContextCandidate[];
  relatedBookmarks: CaptureContextRelatedBookmark[];
}

/** Builds the complete and intentionally bounded payload visible to the model. */
export function buildCaptureModelContext(
  input: CaptureModelContextInput
): CaptureModelContext {
  return {
    currentPage: {
      title: input.title,
      url: redactUrlForModel(input.url),
      ...(input.description
        ? { description: input.description.slice(0, MAX_SUMMARY_LENGTH) }
        : {}),
      ...(input.pageText
        ? { pageText: input.pageText.slice(0, MAX_PAGE_TEXT_LENGTH) }
        : {})
    },
    candidateFolders: input.candidateFolders
      .slice(0, MAX_CANDIDATE_PATHS)
      .map((candidate) => ({
        folderId: candidate.folderId,
        path: candidate.path.map((part) => part.slice(0, 100)).slice(0, 8)
      })),
    relatedBookmarks: input.relatedBookmarks
      .slice(0, MAX_RELATED_BOOKMARKS)
      .map((bookmark) => ({
        id: bookmark.id,
        title: bookmark.title.slice(0, 300),
        url: redactUrlForModel(bookmark.url),
        summary: bookmark.summary.slice(0, MAX_SUMMARY_LENGTH)
      }))
  };
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
