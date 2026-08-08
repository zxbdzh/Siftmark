import type { Rule, RuleAction, RuleEvaluation, RuleEvaluationInput } from './types';

export class RuleEngine {
  constructor(private readonly rules: Rule[]) {}

  evaluate(input: RuleEvaluationInput): RuleEvaluation {
    const matchedRuleIds: string[] = [];
    const actions: RuleAction[] = [];
    let terminalAction: RuleAction | undefined;
    for (const rule of [...this.rules].filter((item) => item.enabled).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)) {
      if (!matches(rule.match, input)) continue;
      matchedRuleIds.push(rule.id);
      for (const action of rule.actions) {
        if (action.type === 'tag') actions.push(action);
        else if (!terminalAction) terminalAction = action;
      }
    }
    if (terminalAction) actions.push(terminalAction);
    return { matchedRuleIds, actions, terminalAction };
  }
}

function matches(match: Rule['match'], input: RuleEvaluationInput): boolean {
  let url: URL;
  try { url = new URL(input.url); } catch { return false; }
  if (match.domain && url.hostname.toLocaleLowerCase() !== match.domain.toLocaleLowerCase()) return false;
  if (match.urlPrefix && !input.url.startsWith(match.urlPrefix)) return false;
  if (match.titleIncludes && !input.title.toLocaleLowerCase().includes(match.titleIncludes.toLocaleLowerCase())) return false;
  if (match.sourceFolderId && match.sourceFolderId !== input.sourceFolderId) return false;
  return true;
}
