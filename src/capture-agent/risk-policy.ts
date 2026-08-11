import type {
  CaptureRiskAssessment,
  CaptureRiskReason
} from './types';
import { getCaptureNewFolderLevelLimit } from './folder-level-policy';

export interface CaptureRiskFacts {
  destination: 'existing' | 'new' | 'unclear';
  newFolderCount?: number;
  creationSource?: 'automatic' | 'explicit-user';
  maxNewFolderLevels?: number;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  duplicate: 'none' | 'exact' | 'similar';
  ruleConflict: boolean;
  sourceTitle: string;
  proposedTitle: string;
  titleMeaningPreserved?: boolean;
  destinationIsSpecial: boolean;
  pageInformation: 'sufficient' | 'insufficient';
  sourceCurrent: boolean;
  treeCurrent: boolean;
}

/**
 * Safe captures are intentionally the narrow case. Every uncertain or
 * irreversible-looking plan is routed through approval.
 */
export function assessCaptureRisk(
  facts: CaptureRiskFacts
): CaptureRiskAssessment {
  const reasons: CaptureRiskReason[] = [];
  const folderCount = Math.max(
    0,
    facts.newFolderCount ?? (facts.destination === 'new' ? 1 : 0)
  );
  const maxNewFolderLevels = getCaptureNewFolderLevelLimit(facts);

  if (facts.destination === 'new' || folderCount > 0)
    reasons.push('new-folder');
  if (folderCount > 1) reasons.push('multi-level-folder-creation');
  if (facts.destination === 'unclear') reasons.push('unclear-destination');
  if (facts.confidence !== 'high') reasons.push('low-confidence');
  if (facts.duplicate === 'exact') reasons.push('exact-duplicate');
  if (facts.duplicate === 'similar') reasons.push('similar-bookmark');
  if (facts.ruleConflict) reasons.push('rule-conflict');
  if (
    facts.titleMeaningPreserved === false ||
    (facts.titleMeaningPreserved === undefined &&
      isLargeTitleChange(facts.sourceTitle, facts.proposedTitle))
  )
    reasons.push('large-title-change');
  if (facts.destinationIsSpecial) reasons.push('special-folder');
  if (facts.pageInformation === 'insufficient')
    reasons.push('insufficient-page-information');
  if (!facts.sourceCurrent || !facts.treeCurrent) reasons.push('stale-state');

  const canExecute =
    facts.destination !== 'unclear' &&
    facts.proposedTitle.trim().length > 0 &&
    facts.sourceCurrent &&
    facts.treeCurrent &&
    folderCount <= maxNewFolderLevels;

  return {
    decision: reasons.length === 0 && canExecute ? 'auto' : 'approval',
    reasons,
    canExecute
  };
}

export function isLargeTitleChange(original: string, proposed: string): boolean {
  const left = normalizeTitle(original);
  const right = normalizeTitle(proposed);
  if (!left || !right) return left !== right;
  if (left === right) return false;
  if (
    Math.min(left.length, right.length) >= 4 &&
    (left.includes(right) || right.includes(left))
  )
    return false;
  return diceCoefficient(left, right) < 0.55;
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function diceCoefficient(left: string, right: string): number {
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
  const leftPairs = pairs(left);
  const rightPairs = pairs(right);
  let intersection = 0;
  for (const [pair, count] of leftPairs) {
    intersection += Math.min(count, rightPairs.get(pair) ?? 0);
  }
  const leftCount = [...leftPairs.values()].reduce(
    (total, count) => total + count,
    0
  );
  const rightCount = [...rightPairs.values()].reduce(
    (total, count) => total + count,
    0
  );
  return (2 * intersection) / (leftCount + rightCount);
}

function pairs(value: string): Map<string, number> {
  const result = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const pair = value.slice(index, index + 2);
    result.set(pair, (result.get(pair) ?? 0) + 1);
  }
  return result;
}
