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
    // Walk through all text nodes in the rendered element
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent && (COMMENT_PATTERN.test(node.textContent) || MASK_PATTERN.test(node.textContent))) {
            // Reset lastIndex after test
            COMMENT_PATTERN.lastIndex = 0;
            MASK_PATTERN.lastIndex = 0;
            textNodes.push(node);
        }
        // Reset lastIndex after test
        COMMENT_PATTERN.lastIndex = 0;
        MASK_PATTERN.lastIndex = 0;
    }

    for (const textNode of textNodes) {
        const text = textNode.textContent || '';
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        // Combine both patterns and process in order of appearance
        interface MatchInfo {
            index: number;
            length: number;
            type: 'comment' | 'mask';
            comment?: string;
            text: string;
        }

        const matches: MatchInfo[] = [];

        // Find all comment matches
        COMMENT_PATTERN.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = COMMENT_PATTERN.exec(text)) !== null) {
            matches.push({
                index: m.index,
                length: m[0].length,
                type: 'comment',
                comment: m[1],
                text: m[2]!,
            });
        }

        // Find all mask matches
        MASK_PATTERN.lastIndex = 0;
        while ((m = MASK_PATTERN.exec(text)) !== null) {
            matches.push({
                index: m.index,
                length: m[0].length,
                type: 'mask',
                text: m[1]!,
            });
        }

        // Sort by position
        matches.sort((a, b) => a.index - b.index);

        for (const match of matches) {
            // Add text before this match
            if (match.index > lastIndex) {
                fragment.appendChild(
                    document.createTextNode(text.slice(lastIndex, match.index))
                );
            }

            if (match.type === 'comment') {
                const span = document.createElement('span');
                span.className = 'annotation-comment';
                span.textContent = match.text;
                span.setAttribute('data-annotation-comment', match.comment || '');

                // Hover events for tooltip
                span.addEventListener('mouseenter', () => {
                    const rect = span.getBoundingClientRect();
                    showTooltip({
                        comment: match.comment || '',
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

                fragment.appendChild(span);
            } else {
                const span = document.createElement('span');
                span.className = 'annotation-mask';
                span.textContent = match.text;
                fragment.appendChild(span);
            }

            lastIndex = match.index + match.length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            fragment.appendChild(
                document.createTextNode(text.slice(lastIndex))
            );
        }

        // Replace the original text node
        textNode.parentNode?.replaceChild(fragment, textNode);
    }
}
