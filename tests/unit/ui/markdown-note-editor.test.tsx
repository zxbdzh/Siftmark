import { describe, expect, it } from 'vitest';
import { sanitizeMarkdown } from '../../../src/ui/markdown/sanitize-markdown';
describe('sanitizeMarkdown', () => { it('escapes raw HTML and blocks remote images', () => { expect(sanitizeMarkdown('<script>x</script> ![a](https://x.test/a.png)')).toContain('&lt;script&gt;x&lt;/script&gt; a [远程图片已阻止]'); }); });
