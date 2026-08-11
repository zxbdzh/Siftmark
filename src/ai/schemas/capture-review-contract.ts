export const CAPTURE_REVIEW_LIMITS = {
  memories: 8,
  domain: 253,
  destinationDepth: 5,
  segment: 64,
  summary: 160,
  reviewSummary: 240
} as const;

export const captureReviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memories', 'reviewSummary'],
  properties: {
    memories: {
      type: 'array',
      maxItems: CAPTURE_REVIEW_LIMITS.memories,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'domain',
          'action',
          'destinationPath',
          'confidence',
          'summary'
        ],
        properties: {
          domain: {
            type: 'string',
            minLength: 1,
            maxLength: CAPTURE_REVIEW_LIMITS.domain
          },
          action: {
            type: 'string',
            enum: ['prefer-folder', 'avoid-folder']
          },
          destinationPath: {
            type: 'array',
            maxItems: CAPTURE_REVIEW_LIMITS.destinationDepth,
            items: {
              type: 'string',
              minLength: 1,
              maxLength: CAPTURE_REVIEW_LIMITS.segment
            }
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low']
          },
          summary: {
            type: 'string',
            minLength: 1,
            maxLength: CAPTURE_REVIEW_LIMITS.summary
          }
        }
      }
    },
    reviewSummary: {
      type: 'string',
      maxLength: CAPTURE_REVIEW_LIMITS.reviewSummary
    }
  }
} as const;

export const CAPTURE_REVIEW_OUTPUT_CONTRACT = [
  '只返回一个包含 memories 和 reviewSummary 的 JSON 对象，不得输出 Markdown。',
  'memories 最多 8 条；每个域名最多一条。',
  '每条 memory 必须且只能包含 domain、action、destinationPath、confidence、summary。',
  'action 只能是 prefer-folder 或 avoid-folder；confidence 只能是 high、medium 或 low。',
  'domain 和 destinationPath 必须原样取自输入证据，不得发明域名或目录。',
  'summary 是用户可见的证据结论，不得描述隐藏推理过程。'
].join('\n');
