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
