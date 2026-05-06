/**
 * ContentBlock parsing utilities for multi-modal chat messages.
 *
 * Handles OpenClaw message content that can be:
 * - A plain string
 * - An array of content blocks: { type: 'text'|'image'|'tool_use'|'tool_result'|'thinking', ... }
 */

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source?: { type: string; media_type?: string; data?: string; url?: string };
  url?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id?: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id?: string;
  content?: string | unknown[];
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking?: string;
  text?: string;
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | Record<string, unknown>;

/** Strip OpenClaw inline directive tags that should never be shown to users */
const DIRECTIVE_TAG_RE = /\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+|audio_as_voice)\s*\]\]/gi;
function stripDirectiveTags(text: string): string {
  return text.replace(DIRECTIVE_TAG_RE, '').replace(/^\s*\n/, '');
}

/**
 * Strip OpenClaw's internal NO_REPLY sentinel that agents sometimes leak into
 * visible message text.  Handles: standalone "NO_REPLY", trailing "NO_REPLY"
 * glued to another word (e.g. "allow-onceNO_REPLY"), standalone JSON
 * {"action":"NO_REPLY"}, and full-line occurrences.
 */
const _NO_REPLY_JSON_RE = /(?:^|\n)\s*\{\s*"action"\s*:\s*"NO_REPLY"\s*\}\s*(?:\n|$)/g;
const _NO_REPLY_BARE_RE = /(?<=\S)NO_REPLY(?=\s|$)|(?:^|\n)\s*NO_REPLY\s*(?:\n|$)/g;
export function stripSilentSentinel(text: string): string {
  return text.replace(_NO_REPLY_JSON_RE, '\n').replace(_NO_REPLY_BARE_RE, '').trim();
}

/** Extract concatenated text from content (string or block array) */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return stripDirectiveTags(content);
  if (!Array.isArray(content)) return '';
  return stripDirectiveTags(
    content
      .filter((b: ContentBlock) => b?.type === 'text')
      .map((b: ContentBlock) => (b as TextBlock).text || '')
      .join('\n')
  );
}

/** Extract image URLs/data URIs from content */
export function extractImages(content: unknown): string[] {
  if (typeof content === 'string') {
    const urls: string[] = [];
    const mdImgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdImgRe.exec(content))) urls.push(m[1]);
    return urls;
  }
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: ContentBlock) => b?.type === 'image')
    .map((b: ContentBlock) => {
      const img = b as ImageBlock;
      if (img.url) return img.url;
      if (img.source?.url) return img.source.url;
      if (img.source?.data && img.source?.media_type) {
        return `data:${img.source.media_type};base64,${img.source.data}`;
      }
      return '';
    })
    .filter(Boolean);
}

/** Extract tool_use blocks */
export function extractToolCalls(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: ContentBlock) => b?.type === 'tool_use') as ToolUseBlock[];
}

/** Extract tool_result blocks */
export function extractToolResults(content: unknown): ToolResultBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: ContentBlock) => b?.type === 'tool_result') as ToolResultBlock[];
}

/** Extract thinking blocks */
export function extractThinking(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: ContentBlock) => b?.type === 'thinking')
    .map((b: ContentBlock) => (b as ThinkingBlock).thinking || (b as ThinkingBlock).text || '')
    .filter(Boolean);
}

/** Check if content has image blocks */
export function hasImages(content: unknown): boolean {
  return extractImages(content).length > 0;
}

/** Check if content has tool_use blocks */
export function hasToolUse(content: unknown): boolean {
  return Array.isArray(content) && content.some((b: ContentBlock) => b?.type === 'tool_use');
}

/** Check if content has thinking blocks */
export function hasThinking(content: unknown): boolean {
  return Array.isArray(content) && content.some((b: ContentBlock) => b?.type === 'thinking');
}
