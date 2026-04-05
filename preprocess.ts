/*
 * preprocess.ts
 *
 * Applies pre-processing rules to markdown content before rendering or passing to Pandoc.
 * The original file is never modified; transformations happen on the in-memory string.
 *
 */

import { PandocPluginSettings, PreprocessRule } from './global';

/**
 * Converts _italic_ syntax (underscore-based) to *italic* syntax (asterisk-based).
 * Only replaces cases where underscores wrap a non-empty run of characters with
 * no leading/trailing spaces inside — i.e. genuine emphasis markers.
 *
 * Why regex instead of a simple replace:
 *   A naïve global replace of '_' with '*' would break snake_case identifiers,
 *   file_names, etc.  The pattern below requires the opening '_' to be preceded by
 *   a word boundary (start-of-string, whitespace, or punctuation) and the closing '_'
 *   to be followed by a word boundary, matching Pandoc's own CommonMark rules.
 */
function fixUnderscoreItalic(markdown: string): string {
    // Matches: (boundary)_(non-empty content without newlines)_(boundary)
    // Boundary before:  start-of-string | whitespace | punctuation (not alphanumeric / underscore)
    // Boundary after:   end-of-string   | whitespace | punctuation
    return markdown.replace(/(?<=[^a-zA-Z0-9_]|^)_([^_\n]+?)_(?=[^a-zA-Z0-9_]|$)/gm, '*$1*');
}

/**
 * Applies a single user-defined rule to a markdown string.
 * If the rule is disabled it is skipped.
 */
function applyRule(markdown: string, rule: PreprocessRule): string {
    if (!rule.enabled) return markdown;
    if (!rule.find) return markdown;

    if (rule.isRegex) {
        try {
            const re = new RegExp(rule.find, 'gm');
            return markdown.replace(re, rule.replace ?? '');
        } catch (e) {
            // Invalid regex — skip silently so export doesn't break
            console.warn(`Pandoc plugin: invalid regex in preprocess rule: ${rule.find}`, e);
            return markdown;
        }
    } else {
        // Plain string — replace all occurrences
        return markdown.split(rule.find).join(rule.replace ?? '');
    }
}

// ── 내부링크 [[link]] 또는 [[link|display]] → display 또는 link 로 변환
const INTERNAL_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function stripInternalLink(value: string): string {
    return value.replace(INTERNAL_LINK_RE, (_match, link, display) =>
        display ? display.trim() : link.trim()
    );
}

function stripQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

/**
 * YAML 프론트매터에서 한글 키(제목, 작가)를 읽어
 * Pandoc용 메타데이터로 변환합니다.
 *
 * - 제목 → title (있으면), 없으면 null
 * - 작가 → author 배열 (내부링크 제거), 없으면 null
 */
export function extractKoreanMetadata(markdown: string): {
    title: string | null;
    author: string[] | null;
} {
    const frontmatterMatch = markdown.trim().match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return { title: null, author: null };

    const lines = frontmatterMatch[1].split('\n');

    let title: string | null = null;
    let author: string[] | null = null;

    let currentKey = '';
    let isArray = false;
    let arrayItems: string[] = [];

    const flushKey = () => {
        if (!currentKey) return;
        if (currentKey === '제목' && !isArray && arrayItems.length === 0) {
            // 이미 인라인 값으로 처리됨
        }
        if (currentKey === '작가' && isArray) {
            author = arrayItems
                .map(item => stripInternalLink(stripQuotes(item)))
                .filter(v => v.length > 0);
        }
        currentKey = '';
        isArray = false;
        arrayItems = [];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('- ')) {
            if (isArray) {
                arrayItems.push(trimmed.substring(2).trim());
            }
            continue;
        }

        const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
        if (kvMatch) {
            flushKey();
            currentKey = kvMatch[1].trim();
            const value = kvMatch[2].trim();

            if (!value) {
                isArray = true;
                arrayItems = [];
            } else {
                isArray = false;
                arrayItems = [];
                if (currentKey === '제목') {
                    title = stripInternalLink(stripQuotes(value));
                }
                // 인라인 값이므로 flushKey 불필요 — currentKey 초기화
                currentKey = '';
            }
        }
    }
    // 마지막 키 처리
    flushKey();

    return { title, author };
}

/**
 * Main entry point.
 * Applies all enabled preprocessing steps to `markdown` and returns the result.
 * The input string is never mutated.
 */
export function applyPreprocess(markdown: string, settings: PandocPluginSettings): string {
    let result = markdown;

    if (settings.underscoreItalicFix) {
        result = fixUnderscoreItalic(result);
    }

    for (const rule of settings.preprocessRules) {
        result = applyRule(result, rule);
    }

    return result;
}
