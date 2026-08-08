import type { SearchDocument } from '../types';
import type { EmbeddingCandidate, EmbeddingIndexProgress, EmbeddingPort, EmbeddingVersion } from './types';
import { EmbeddingRepository } from './embedding-repository';

export class EmbeddingIndexer {
  constructor(private readonly repository: EmbeddingRepository, private readonly now: () => number = Date.now) {}

  async enqueueMissing(documents: SearchDocument[], version: EmbeddingVersion): Promise<EmbeddingCandidate[]> {
    const candidates = documents.map((document) => {
      const input = buildEmbeddingText(document);
      return { document, input, inputHash: hashEmbeddingInput(input) };
    });
    const current = await Promise.all(candidates.map((candidate) => this.repository.findCurrent(candidate.document.bookmarkId, version)));
    return candidates.filter((candidate, index) => current[index]?.inputHash !== candidate.inputHash);
  }

  async index(
    documents: SearchDocument[],
    version: EmbeddingVersion,
    port: EmbeddingPort,
    options: { chunkSize?: number; signal?: AbortSignal; onProgress?(completed: number, total: number): Promise<void> | void } = {}
  ): Promise<EmbeddingIndexProgress> {
    await this.repository.markOtherVersionsStale(version);
    const candidates = await this.enqueueMissing(documents, version);
    const chunkSize = Math.max(1, options.chunkSize ?? 25);
    let completed = 0;
    let dimensions: number | undefined;

    for (let offset = 0; offset < candidates.length; offset += chunkSize) {
      if (options.signal?.aborted) return { completed, total: candidates.length, state: 'paused', dimensions };
      const chunk = candidates.slice(offset, offset + chunkSize);
      const vectors = await port.embed(chunk.map((candidate) => candidate.input), options.signal ?? new AbortController().signal);
      if (vectors.length !== chunk.length) throw new Error('Embedding 返回数量与输入不一致');
      const nextDimensions = validateVectors(vectors, dimensions);
      dimensions = nextDimensions;
      await Promise.all(chunk.map((candidate, index) => this.repository.put({
        bookmarkId: candidate.document.bookmarkId,
        key: { ...version, dimensions: nextDimensions },
        values: vectors[index]!,
        inputHash: candidate.inputHash,
        stale: false,
        updatedAt: this.now()
      })));
      completed += chunk.length;
      await options.onProgress?.(completed, candidates.length);
    }
    return { completed, total: candidates.length, state: 'succeeded', dimensions };
  }
}

export function buildEmbeddingText(document: SearchDocument): string {
  return [
    `标题: ${document.title}`,
    `域名: ${domainOf(document.url)}`,
    `文件夹: ${document.folderPath}`,
    `标签: ${document.tags.join('、')}`,
    `摘要: ${document.summary}`
  ].join('\n');
}

export function hashEmbeddingInput(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function validateVectors(vectors: number[][], expected?: number): number {
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0 || (expected !== undefined && dimensions !== expected)) throw new Error('Embedding 维度无效或发生变化');
  if (vectors.some((vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) throw new Error('Embedding 向量格式无效');
  return dimensions;
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.toLocaleLowerCase(); }
  catch { return ''; }
}
