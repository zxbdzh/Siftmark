export function sanitizeMarkdown(markdown: string): string {
  return markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1 [远程图片已阻止]');
}
