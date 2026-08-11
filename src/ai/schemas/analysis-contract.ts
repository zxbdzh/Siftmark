export const ANALYSIS_RESULT_FIELDS = [
  'folderPath',
  'title',
  'tags',
  'summary',
  'confidence',
  'reason'
] as const;

export const ANALYSIS_RESULT_LIMITS = {
  folderPath: {
    maxItems: 5,
    segmentMinLength: 1,
    segmentMaxLength: 64
  },
  title: { minLength: 1, maxLength: 160 },
  tags: {
    maxItems: 12,
    itemMinLength: 1,
    itemMaxLength: 32
  },
  summary: { maxLength: 240 },
  reason: { maxLength: 120 }
} as const;

const limits = ANALYSIS_RESULT_LIMITS;

export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ANALYSIS_RESULT_FIELDS,
  properties: {
    folderPath: {
      type: 'array',
      maxItems: limits.folderPath.maxItems,
      items: {
        type: 'string',
        minLength: limits.folderPath.segmentMinLength,
        maxLength: limits.folderPath.segmentMaxLength
      }
    },
    title: {
      type: 'string',
      minLength: limits.title.minLength,
      maxLength: limits.title.maxLength
    },
    tags: {
      type: 'array',
      maxItems: limits.tags.maxItems,
      items: {
        type: 'string',
        minLength: limits.tags.itemMinLength,
        maxLength: limits.tags.itemMaxLength
      }
    },
    summary: { type: 'string', maxLength: limits.summary.maxLength },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string', maxLength: limits.reason.maxLength }
  }
} as const;

const analysisOutputShape = {
  folderPath: ['开发'],
  title: '页面标题',
  tags: ['AI'],
  summary: '页面摘要',
  confidence: 'high',
  reason: '归类理由'
};

export const ANALYSIS_OUTPUT_CONTRACT = [
  `输出必须是一个 JSON 对象，并且必须包含且仅包含以下六个字段：${ANALYSIS_RESULT_FIELDS.map((field) => `"${field}"`).join('、')}。`,
  `严格按照这个形状返回：${JSON.stringify(analysisOutputShape)}`,
  `"folderPath" 必须是字符串数组，最多 ${limits.folderPath.maxItems} 层；每层名称长度为 ${limits.folderPath.segmentMinLength}-${limits.folderPath.segmentMaxLength} 个字符，且不得包含斜杠、反斜杠或控制字符。`,
  `"title" 必须是字符串，长度为 ${limits.title.minLength}-${limits.title.maxLength} 个字符。`,
  `"tags" 必须是字符串数组，最多 ${limits.tags.maxItems} 项；每项长度为 ${limits.tags.itemMinLength}-${limits.tags.itemMaxLength} 个字符，忽略大小写后不得重复。`,
  `"summary" 必须是字符串，summary 最多 ${limits.summary.maxLength} 个字符。`,
  '"confidence" 必须且只能是 "high"、"medium" 或 "low"。',
  `"reason" 必须是字符串，最多 ${limits.reason.maxLength} 个字符。`,
  '不得添加其他字段，不得省略任何字段，不得输出 Markdown 代码围栏。'
].join('\n');
