import { describe, expect, it } from 'vitest';
import { RuleEngine } from '../../../src/rules/rule-engine';
import type { Rule } from '../../../src/rules/types';

const rule = (patch: Partial<Rule>): Rule => ({ id: 'r', name: 'rule', priority: 1, createdAt: 1, enabled: true, match: { domain: 'example.com' }, actions: [{ type: 'tag', tag: '默认' }], ...patch });

describe('RuleEngine', () => {
  it('sorts by priority and accumulates tags before the first terminal action', () => {
    const result = new RuleEngine([
      rule({ id: 'low', priority: 1, actions: [{ type: 'move', folderId: 'low' }] }),
      rule({ id: 'high', priority: 5, actions: [{ type: 'tag', tag: '高优先级' }, { type: 'move', folderId: 'high' }] }),
      rule({ id: 'later', priority: 0, actions: [{ type: 'tag', tag: '仍应累加' }] })
    ]).evaluate({ url: 'https://example.com/a', title: 'Article' });
    expect(result.matchedRuleIds).toEqual(['high', 'low', 'later']);
    expect(result.terminalAction).toEqual({ type: 'move', folderId: 'high' });
    expect(result.actions).toContainEqual({ type: 'tag', tag: '高优先级' });
    expect(result.actions).toContainEqual({ type: 'tag', tag: '仍应累加' });
  });

  it('matches title and source folder predicates', () => {
    const result = new RuleEngine([rule({ match: { titleIncludes: 'AI', sourceFolderId: 'source' }, actions: [{ type: 'skip-ai' }] })]).evaluate({ url: 'https://example.com/a', title: 'AI notes', sourceFolderId: 'source' });
    expect(result.terminalAction).toEqual({ type: 'skip-ai' });
  });
});
