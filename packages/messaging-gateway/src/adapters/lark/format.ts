export type LarkPostElement = { tag: 'text'; text: string } | { tag: 'a'; text: string; href: string }
export interface LarkPost { zh_cn: { title: string; content: LarkPostElement[][] } }
export type LarkFormatted = { kind: 'text'; text: string } | { kind: 'post'; post: LarkPost }
/** Conservative Markdown conversion: plain text stays text, links become post links. */
export function formatForLarkPost(markdown: string): LarkFormatted {
  const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/m.exec(markdown.trim())
  if (!link) return { kind: 'text', text: markdown }
  return { kind: 'post', post: { zh_cn: { title: '', content: [[{ tag: 'a', text: link[1]!, href: link[2]! }]] } } }
}
export function wrapAsTrivialPost(text: string): LarkPost { return { zh_cn: { title: '', content: [[{ tag: 'text', text }]] } } }
