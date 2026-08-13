/** Escape MarkdownV2 metacharacters before sending agent text through Telegram. */
export function escapeTelegramMarkdown(text: string): string { return text.replace(/([_\*\[\]()~`>#+\-=|{}.!])/g, '\\$1') }
export function formatForTelegram(text: string): string { return escapeTelegramMarkdown(text) }
