import { MarkdownPostProcessorContext } from 'obsidian';
import { COMMENT_PATTERN, MASK_PATTERN } from './parser';
import { showTooltip, hideTooltip } from './tooltipWidget';

/**
 * MarkdownPostProcessor for Reading View.
 * Processes rendered text nodes and replaces annotation syntax with
 * styled <span> elements.
 */
export function annotationPostProcessor(
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext
): void {
    const text = el.textContent || '';
    if (!COMMENT_PATTERN.test(text) && !MASK_PATTERN.test(text)) {
        return;
    }

    // Reset patterns
    COMMENT_PATTERN.lastIndex = 0;
    MASK_PATTERN.lastIndex = 0;

    // 1. Collect all text nodes and their starting offsets in the joined text
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text, start: number, end: number }[] = [];
    let currentOffset = 0;
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        const length = node.textContent?.length || 0;
        nodes.push({ node, start: currentOffset, end: currentOffset + length });
        currentOffset += length;
    }

    // 2. Find all matches in the joined text
    interface MatchInfo {
        start: number;
        end: number;
        type: 'comment' | 'mask';
        contentStart: number;
        contentEnd: number;
        commentText?: string;
    }
    const matches: MatchInfo[] = [];

    // Find comments: ==text::comment==
    let m: RegExpExecArray | null;
    COMMENT_PATTERN.lastIndex = 0;
    while ((m = COMMENT_PATTERN.exec(text)) !== null) {
        if (!m[1] || !m[2]) continue;
        matches.push({
            start: m.index,
            end: m.index + m[0].length,
            type: 'comment',
            contentStart: m.index + 1, // Skip "="
            contentEnd: m.index + 1 + m[1].length,
            commentText: m[2],
        });
    }

    // Find masks: ~=text=~
    MASK_PATTERN.lastIndex = 0;
    while ((m = MASK_PATTERN.exec(text)) !== null) {
        if (!m[1]) continue;
        matches.push({
            start: m.index,
            end: m.index + m[0].length,
            type: 'mask',
            contentStart: m.index + 2, // Skip "~="
            contentEnd: m.index + 2 + m[1].length,
        });
    }

    // Sort matches in REVERSE order to avoid offset changes when modifying DOM
    // However, since we are wrapping with Ranges, we should be careful.
    // Actually, wrapping with a span might still affect offsets if not careful.
    // A better way is to process from LAST to FIRST.
    matches.sort((a, b) => b.start - a.start);

    // 3. Helper to find (Node, Offset) for a given absolute offset in textContent
    const getPos = (offset: number): { node: Text, offset: number } | null => {
        for (const meta of nodes) {
            if (offset >= meta.start && offset <= meta.end) {
                return { node: meta.node, offset: offset - meta.start };
            }
        }
        return null;
    };

    // 4. Wrap each match
    for (const match of matches) {
        const startPos = getPos(match.start);
        const endPos = getPos(match.end);

        if (!startPos || !endPos) continue;

        try {
            const range = document.createRange();
            range.setStart(startPos.node, startPos.offset);
            range.setEnd(endPos.node, endPos.offset);

            // Extract the entire match (=text::comment= or ~=text=~)
            const fragment = range.extractContents();

            // Helper to remove count characters from the start/end of the fragment
            const removeChars = (frag: DocumentFragment, count: number, fromStart: boolean) => {
                let remaining = count;
                while (remaining > 0) {
                    const node = fromStart ? frag.firstChild : frag.lastChild;
                    if (!node) break;

                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = node.textContent || '';
                        const toRemove = Math.min(remaining, text.length);
                        if (fromStart) {
                            node.textContent = text.slice(toRemove);
                        } else {
                            node.textContent = text.slice(0, text.length - toRemove);
                        }
                        remaining -= toRemove;
                        if (node.textContent === '') frag.removeChild(node);
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        // If it's an element, we need to recurse or skip.
                        // For our markers, they are always text at the boundaries.
                        break;
                    } else {
                        frag.removeChild(node);
                    }
                }
            };

            // Calculate marker lengths
            // Mask: ~= (2) and =~ (2)
            // Comment: = (1) and ::comment= (rest)
            let startMarkerLen = 0;
            let endMarkerLen = 0;

            if (match.type === 'mask') {
                startMarkerLen = 2;
                endMarkerLen = 2;
            } else {
                startMarkerLen = 1;
                // The match is =text::comment=, we want only text inside.
                // So end marker is everything from :: to the end.
                const fullMatchText = text.slice(match.start, match.end);
                const separatorIndex = fullMatchText.indexOf('::');
                if (separatorIndex !== -1) {
                    endMarkerLen = fullMatchText.length - separatorIndex;
                }
            }

            // Remove markers from the fragment
            removeChars(fragment, endMarkerLen, false);
            removeChars(fragment, startMarkerLen, true);

            // Wrap the cleaned fragment in a span
            const span = document.createElement('span');
            if (match.type === 'comment') {
                span.className = 'annotation-comment';
                span.setAttribute('data-annotation-comment', match.commentText || '');
                // Hover events for tooltip
                span.addEventListener('mouseenter', () => {
                    const rect = span.getBoundingClientRect();
                    showTooltip({
                        comment: match.commentText || '',
                        rect,
                        container: document.body
                    });
                });
                span.addEventListener('mouseleave', (evt) => {
                    const related = evt.relatedTarget as HTMLElement | null;
                    if (!related || !related.classList.contains('annotation-tooltip')) {
                        hideTooltip();
                    }
                });
            } else {
                span.className = 'annotation-mask';
            }

            span.appendChild(fragment);
            range.insertNode(span);

        } catch (e) {
            console.error('Failed to wrap annotation:', e, match);
        }
    }
}
