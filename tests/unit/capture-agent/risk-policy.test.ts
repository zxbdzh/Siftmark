import { describe, expect, it } from 'vitest';
import {
  assessCaptureRisk,
  isLargeTitleChange,
  type CaptureRiskFacts
} from '../../../src/capture-agent';

const safeFacts: CaptureRiskFacts = {
  destination: 'existing',
  confidence: 'high',
  duplicate: 'none',
  ruleConflict: false,
  sourceTitle: 'React Server Components Guide',
  proposedTitle: 'React Server Components Guide',
  destinationIsSpecial: false,
  pageInformation: 'sufficient',
  sourceCurrent: true,
  treeCurrent: true
};

describe('capture risk policy', () => {
  it('auto-executes only the narrow high-confidence existing-folder case', () => {
    expect(assessCaptureRisk(safeFacts)).toEqual({
      decision: 'auto',
      reasons: [],
      canExecute: true
    });
  });

  it.each([
    [{ destination: 'new', newFolderCount: 1 }, 'new-folder'],
    [{ destination: 'unclear' }, 'unclear-destination'],
    [{ confidence: 'medium' }, 'low-confidence'],
    [{ duplicate: 'exact' }, 'exact-duplicate'],
    [{ duplicate: 'similar' }, 'similar-bookmark'],
    [{ ruleConflict: true }, 'rule-conflict'],
    [{ proposedTitle: 'A completely different topic' }, 'large-title-change'],
    [{ destinationIsSpecial: true }, 'special-folder'],
    [
      { pageInformation: 'insufficient' },
      'insufficient-page-information'
    ],
    [{ sourceCurrent: false }, 'stale-state'],
    [{ treeCurrent: false }, 'stale-state']
  ] as const)('requires approval for %s', (patch, reason) => {
    expect(assessCaptureRisk({ ...safeFacts, ...patch })).toMatchObject({
      decision: 'approval',
      reasons: expect.arrayContaining([reason])
    });
  });

  it('does not execute automatic multi-level folder creation', () => {
    expect(
      assessCaptureRisk({
        ...safeFacts,
        destination: 'new',
        newFolderCount: 2,
        creationSource: 'automatic'
      })
    ).toMatchObject({
      decision: 'approval',
      canExecute: false,
      reasons: ['new-folder', 'multi-level-folder-creation']
    });
  });

  it('allows automatic multi-level creation only within the configured limit', () => {
    expect(
      assessCaptureRisk({
        ...safeFacts,
        destination: 'new',
        newFolderCount: 2,
        creationSource: 'automatic',
        maxNewFolderLevels: 2
      })
    ).toMatchObject({ decision: 'approval', canExecute: true });
    expect(
      assessCaptureRisk({
        ...safeFacts,
        destination: 'new',
        newFolderCount: 3,
        creationSource: 'automatic',
        maxNewFolderLevels: 2
      })
    ).toMatchObject({ decision: 'approval', canExecute: false });
  });

  it('never marks a locally non-executable plan for automatic execution', () => {
    expect(
      assessCaptureRisk({
        ...safeFacts,
        sourceTitle: '',
        proposedTitle: ''
      })
    ).toMatchObject({ decision: 'approval', canExecute: false });
  });

  it('allows an explicitly requested multi-level plan to reach approval', () => {
    expect(
      assessCaptureRisk({
        ...safeFacts,
        destination: 'new',
        newFolderCount: 2,
        creationSource: 'explicit-user'
      })
    ).toMatchObject({ decision: 'approval', canExecute: true });
  });

  it('uses a conservative local title check', () => {
    expect(
      isLargeTitleChange(
        'React Server Components Guide',
        'React Server Components Guide 中文版'
      )
    ).toBe(false);
    expect(
      isLargeTitleChange(
        'React Server Components Guide',
        'Italian Pasta Recipes'
      )
    ).toBe(true);
  });
});
