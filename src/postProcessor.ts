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
        commentText?: string;
        startMarkerLen: number;
        endMarkerLen: number;
    }
    const matches: MatchInfo[] = [];

    // Find comments: (=+)text::comment\1
    let m: RegExpExecArray | null;
    COMMENT_PATTERN.lastIndex = 0;
    while ((m = COMMENT_PATTERN.exec(text)) !== null) {
        if (!m[1] || !m[2] || !m[3]) continue;
        const markerLen = m[1].length;
        matches.push({
            start: m.index,
            end: m.index + m[0].length,
            type: 'comment',
            commentText: m[3],
            startMarkerLen: markerLen,
            endMarkerLen: m[0].length - markerLen - m[2].length, // length from :: to the end
        });
    }

    // Find masks: ~(=+)text\1~
    MASK_PATTERN.lastIndex = 0;
    while ((m = MASK_PATTERN.exec(text)) !== null) {
        if (!m[1] || !m[2]) continue;
        const markerLen = m[1].length + 1; // ~ + equals
        matches.push({
            start: m.index,
            end: m.index + m[0].length,
            type: 'mask',
            startMarkerLen: markerLen,
            endMarkerLen: markerLen,
        });
    }

    // Sort matches in REVERSE order to avoid DOM inconsistency
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

            // Extract the entire match
            const fragment = range.extractContents();

            // Robust recursive char removal
            const removeChars = (root: Node, count: number, fromStart: boolean) => {
                let remaining = count;
                while (remaining > 0) {
                    const node = fromStart ? root.firstChild : root.lastChild;
                    if (!node) break;

                    if (node.nodeType === Node.TEXT_NODE) {
                        const t = node.textContent || '';
                        const toRemove = Math.min(remaining, t.length);
                        if (fromStart) {
                            node.textContent = t.slice(toRemove);
                        } else {
                            node.textContent = t.slice(0, t.length - toRemove);
                        }
                        remaining -= toRemove;
                        if (node.textContent === '') root.removeChild(node);
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        const nodeTextLen = node.textContent?.length || 0;
                        if (nodeTextLen <= remaining) {
                            remaining -= nodeTextLen;
                            root.removeChild(node);
                        } else {
                            removeChars(node, remaining, fromStart);
                            remaining = 0;
                        }
                    } else {
                        root.removeChild(node);
                        remaining--; // approximate
                    }
                }
            };

            // Remove markers from the fragment
            removeChars(fragment, match.endMarkerLen, false);
            removeChars(fragment, match.startMarkerLen, true);

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
