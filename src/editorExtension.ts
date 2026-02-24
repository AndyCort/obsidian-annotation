import {
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, Prec } from '@codemirror/state';
import { editorLivePreviewField, renderMath, finishRenderMath } from 'obsidian';
import { parseAnnotationsFromLine } from './parser';
import { Annotation, AnnotationPluginSettings } from './types';
import { showTooltip, hideTooltip } from './tooltipWidget';

/**
 * A zero-width widget used to replace the syntax markers (== and ::) so
 * that only the annotated text remains visible in live preview.
 */
class HiddenMarkerWidget extends WidgetType {
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.style.display = 'none';
        return span;
    }
}

/**
 * A widget that replaces the entire ~=content=~ range.
 * It renders the content (including LaTeX) inside a blurred container.
 *
 * We use Decoration.replace() + Prec.highest() to ensure our decoration
 * takes priority over Obsidian's built-in math rendering, which also uses
 * replace decorations for $...$ ranges.
 */
class MaskWidget extends WidgetType {
    constructor(private content: string) {
        super();
    }

    toDOM(): HTMLElement {
        const wrapper = document.createElement('span');
        wrapper.className = 'annotation-mask';

        this.renderContent(wrapper);

        // finishRenderMath must be called AFTER element is in the DOM.
        // Schedule it for the next microtask/frame when CM6 has mounted this widget.
        setTimeout(() => {
            try {
                finishRenderMath();
            } catch {
                // ignore
            }
        }, 50);

        return wrapper;
    }

    /**
     * Render text content, replacing $...$ and $$...$$ with rendered math.
     */
    private renderContent(container: HTMLElement): void {
        const text = this.content;

        // Match $$...$$ (display math) first, then $...$ (inline math)
        const mathRegex = /\$\$([\s\S]*?)\$\$|\$((?:[^$\\]|\\.)+?)\$/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = mathRegex.exec(text)) !== null) {
            // Add plain text before the math expression
            if (match.index > lastIndex) {
                container.appendChild(
                    document.createTextNode(text.slice(lastIndex, match.index))
                );
            }

            const displayMath = match[1]; // from $$...$$
            const inlineMath = match[2];  // from $...$
            const mathSource = displayMath !== undefined ? displayMath : (inlineMath || '');
            const isDisplay = displayMath !== undefined;

            try {
                const mathEl = renderMath(mathSource, isDisplay);
                container.appendChild(mathEl);
            } catch {
                // Fallback: show raw LaTeX text
                container.appendChild(document.createTextNode(match[0]));
            }

            lastIndex = match.index + match[0].length;
        }

        // Add remaining plain text
        if (lastIndex < text.length) {
            container.appendChild(
                document.createTextNode(text.slice(lastIndex))
            );
        }
    }

    eq(other: MaskWidget): boolean {
        return this.content === other.content;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Collect all annotations from visible ranges.
 */
function collectAnnotations(view: EditorView): Annotation[] {
    const annotations: Annotation[] = [];

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.sliceDoc(from, to);
        const lines = text.split('\n');
        let offset = from;

        for (const line of lines) {
            const lineAnnotations = parseAnnotationsFromLine(line, offset);
            annotations.push(...lineAnnotations);
            offset += line.length + 1;
        }
    }

    annotations.sort((a, b) => a.syntaxFrom - b.syntaxFrom);
    return annotations;
}

/**
 * Build decorations for all visible annotations in the editor.
 */
function buildDecorations(view: EditorView, annotations: Annotation[]): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    let isLivePreview: boolean;
    try {
        isLivePreview = view.state.field(editorLivePreviewField);
    } catch {
        isLivePreview = false;
    }

    for (const ann of annotations) {
        if (ann.type === 'comment') {
            if (isLivePreview) {
                const cursorInside = view.state.selection.ranges.some(
                    range => range.from >= ann.syntaxFrom && range.to <= ann.syntaxTo
                );

                if (!cursorInside) {
                    builder.add(ann.syntaxFrom, ann.from,
                        Decoration.replace({ widget: new HiddenMarkerWidget() }));
                    builder.add(ann.from, ann.to,
                        Decoration.mark({
                            class: 'annotation-comment',
                            attributes: { 'data-annotation-comment': ann.comment },
                        }));
                    builder.add(ann.to, ann.syntaxTo,
                        Decoration.replace({ widget: new HiddenMarkerWidget() }));
                } else {
                    builder.add(ann.from, ann.to,
                        Decoration.mark({
                            class: 'annotation-comment',
                            attributes: { 'data-annotation-comment': ann.comment },
                        }));
                }
            } else {
                builder.add(ann.from, ann.to,
                    Decoration.mark({
                        class: 'annotation-comment',
                        attributes: { 'data-annotation-comment': ann.comment },
                    }));
            }
        } else if (ann.type === 'mask') {
            if (isLivePreview) {
                const cursorInside = view.state.selection.ranges.some(
                    range => range.from >= ann.syntaxFrom && range.to <= ann.syntaxTo
                );

                if (!cursorInside) {
                    // Replace the ENTIRE ~=content=~ with our MaskWidget that renders
                    // the content (including math) inside a blur container.
                    const maskContent = view.state.sliceDoc(ann.from, ann.to);
                    builder.add(ann.syntaxFrom, ann.syntaxTo,
                        Decoration.replace({ widget: new MaskWidget(maskContent) }));
                } else {
                    // Cursor inside: show raw text with blur mark
                    builder.add(ann.from, ann.to,
                        Decoration.mark({ class: 'annotation-mask' }));
                }
            } else {
                builder.add(ann.from, ann.to,
                    Decoration.mark({ class: 'annotation-mask' }));
            }
        }
    }

    return builder.finish();
}

/**
 * Create the CodeMirror 6 editor extension for annotation decorations.
 */
export function createAnnotationEditorExtension(settings: AnnotationPluginSettings) {
    const annotationViewPlugin = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildDecorations(view, collectAnnotations(view));
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.selectionSet
                ) {
                    this.decorations = buildDecorations(
                        update.view,
                        collectAnnotations(update.view)
                    );
                }
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );

    // Hover event handler for tooltips
    const hoverHandler = EditorView.domEventHandlers({
        mouseover(event: MouseEvent, view: EditorView) {
            const target = event.target as HTMLElement;

            if (target.classList.contains('annotation-comment')) {
                const comment = target.getAttribute('data-annotation-comment');
                if (comment) {
                    const rect = target.getBoundingClientRect();
                    const pos = view.posAtDOM(target);
                    const line = view.state.doc.lineAt(pos);
                    const annotations = parseAnnotationsFromLine(line.text, line.from);
                    const ann = annotations.find(
                        a => a.type === 'comment' && a.from <= pos && a.to >= pos
                    ) as any;

                    if (ann) {
                        showTooltip({
                            comment,
                            rect,
                            container: document.body,
                            onSave: (newComment: string) => {
                                view.dispatch({
                                    changes: {
                                        from: ann.syntaxFrom,
                                        to: ann.from,
                                        insert: `==${newComment}::`
                                    }
                                });
                            }
                        });
                    } else {
                        showTooltip({ comment, rect, container: document.body });
                    }
                }
            }
        },
        mouseout(event: MouseEvent) {
            const target = event.target as HTMLElement;
            const related = event.relatedTarget as HTMLElement | null;

            if (
                target.classList.contains('annotation-comment') &&
                (!related || !related.classList.contains('annotation-tooltip'))
            ) {
                hideTooltip();
            }
        },
    });

    // Use Prec.highest() to ensure our decorations take priority over
    // Obsidian's built-in math rendering (which also uses replace decorations).
    return [Prec.highest(annotationViewPlugin), hoverHandler];
}
