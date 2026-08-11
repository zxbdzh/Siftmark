import { describe, expect, it, vi } from 'vitest';
import fixture from '../../fixtures/ai/gemini-success.json';
import { GeminiGenerateContentAdapter } from '../../../src/ai/adapters/gemini-generate-content';
import type { ModelProfile } from '../../../src/ai/types';

const profile: ModelProfile = { id: 'p', version: 'v1', name: 'P', protocol: 'gemini-generate-content', endpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini', apiKey: 'key', timeoutMs: 1000, capabilities: ['classify'], state: 'verified' };

describe('GeminiGenerateContentAdapter', () => {
  it('probes Gemini JSON schema output', async () => {
    const post = vi.fn().mockResolvedValue({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    const result = await new GeminiGenerateContentAdapter(post).testConnection(profile, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ generationConfig: expect.objectContaining({ responseMimeType: 'application/json', responseJsonSchema: expect.any(Object) }) }) }));
    expect(result.structuredOutput).toBe(true);
    expect(result.embedding).toBe(false);
  });

  it('uses model generateContent path and header authentication', async () => {
    const post = vi.fn().mockResolvedValue(fixture);
    const result = await new GeminiGenerateContentAdapter(post).analyze(profile, { title: 'A', url: 'https://a.test', currentFolderPath: [] }, new AbortController().signal);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/models\/gemini:generateContent$/), headers: { 'x-goog-api-key': 'key' }, body: expect.objectContaining({ systemInstruction: expect.any(Object), contents: expect.any(Array) }) }));
    expect(result.title).toBe('论文');
  });

  it('reviews capture history with the Gemini JSON schema contract', async () => {
    const post = vi.fn().mockResolvedValue({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              {
                text: JSON.stringify({
                  memories: [],
                  reviewSummary: '暂未发现稳定规律'
                })
              }
            ]
          }
        }
      ]
    });

    const result = await new GeminiGenerateContentAdapter(
      post
    ).reviewCaptureHistory(
      profile,
      { examples: [] },
      new AbortController().signal
    );

    expect(result.reviewSummary).toBe('暂未发现稳定规律');
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          generationConfig: expect.objectContaining({
            responseMimeType: 'application/json',
            responseJsonSchema: expect.objectContaining({
              required: ['memories', 'reviewSummary']
            })
          })
        })
      })
    );
  });
});
