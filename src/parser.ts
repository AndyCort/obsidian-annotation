import { Annotation } from './types';

/**
 * Regex patterns for annotation syntax:
 * - Comment: ==comment::text==
 * - Mask: ~=text=~
 * 
 * Using non-greedy `[\s\S]*?` allows matching content that includes '=' or newlines (like LaTeX).
 */
const COMMENT_REGEX = /==([\s\S]*?)::([\s\S]*?)==/g;
const MASK_REGEX = /~=([\s\S]*?)=~/g;

/**
 * Parse a line of text and return all annotations found.
 * Positions are relative to `offset` (the absolute document position of the line start).
 */
export function parseAnnotationsFromLine(lineText: string, offset: number): Annotation[] {
    const results: Annotation[] = [];

    // Parse comments: ==comment::text==
    let match: RegExpExecArray | null;
    COMMENT_REGEX.lastIndex = 0;
    while ((match = COMMENT_REGEX.exec(lineText)) !== null) {
        const fullMatchStart = offset + match.index;
        const fullMatchEnd = fullMatchStart + match[0].length;
        const comment = match[1]!;
        const text = match[2]!;

        // The visible text starts after "==comment::" and ends before "=="
        const prefixLen = 2 + comment.length + 2; // "==" + comment + "::"
        const textFrom = fullMatchStart + prefixLen;
        const textTo = textFrom + text.length;

        results.push({
            type: 'comment',
            from: textFrom,
            to: textTo,
            comment: comment,
            syntaxFrom: fullMatchStart,
            syntaxTo: fullMatchEnd,
        });
    }

    // Parse masks: ~=text=~
    MASK_REGEX.lastIndex = 0;
    while ((match = MASK_REGEX.exec(lineText)) !== null) {
        const fullMatchStart = offset + match.index;
        const fullMatchEnd = fullMatchStart + match[0].length;
        const text = match[1]!;

        // The visible text starts after "~=" and ends before "=~"
        const textFrom = fullMatchStart + 2;
        const textTo = textFrom + text.length;

        results.push({
            type: 'mask',
            from: textFrom,
            to: textTo,
            syntaxFrom: fullMatchStart,
            syntaxTo: fullMatchEnd,
        });
    }

    return results;
}

/**
 * Parse all annotations from a full document text.
 * Splits by lines to calculate correct absolute positions.
 */
export function parseAnnotations(docText: string): Annotation[] {
    const results: Annotation[] = [];
    const lines = docText.split('\n');
    let offset = 0;

    for (const line of lines) {
        results.push(...parseAnnotationsFromLine(line, offset));
        offset += line.length + 1; // +1 for the newline character
    }

    return results;
}

/**
 * Regex patterns exported for use in post-processor (HTML text node parsing).
 */
export const COMMENT_PATTERN = /==([\s\S]*?)::([\s\S]*?)==/g;
export const MASK_PATTERN = /~=([\s\S]*?)=~/g;
