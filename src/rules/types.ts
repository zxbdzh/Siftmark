export type RuleAction =
  | { type: 'move'; folderId: string }
  | { type: 'tag'; tag: string }
  | { type: 'skip-ai' }
  | { type: 'send-to-inbox' };

export interface RuleMatch {
  domain?: string;
  urlPrefix?: string;
  titleIncludes?: string;
  sourceFolderId?: string;
}

export interface Rule {
  id: string;
  name: string;
  priority: number;
  createdAt: number;
  enabled: boolean;
  match: RuleMatch;
  actions: RuleAction[];
}

export interface RuleEvaluationInput {
  url: string;
  title: string;
  sourceFolderId?: string;
}

export interface RuleEvaluation {
  matchedRuleIds: string[];
  actions: RuleAction[];
  terminalAction?: RuleAction;
}
