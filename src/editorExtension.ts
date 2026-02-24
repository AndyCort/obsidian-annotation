import {
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
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
 * A widget that replaces the entire mask syntax (~=content=~) with a
 * blurred container that renders the content including LaTeX math.
 *
 * Uses Obsidian's renderMath/finishRenderMath API.
 * Key fix: finishRenderMath() is deferred via requestAnimationFrame
 * so it runs AFTER CM6 has mounted the widget in the document DOM.
 */
class MaskWidget extends WidgetType {
    constructor(private content: string) {
        super();
    }

    toDOM(): HTMLElement {
        const wrapper = document.createElement('span');
        wrapper.className = 'annotation-mask';

        let hasMath = false;
        const text = this.content;

        // Regex: find $$...$$ (display math) or $...$ (inline math)
        const mathRegex = /\$\$([\s\S]*?)\$\$|\$((?:[^$\\]|\\.)+?)\$/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = mathRegex.exec(text)) !== null) {
            // Add plain text before this math expression
            if (match.index > lastIndex) {
                wrapper.appendChild(
                    document.createTextNode(text.slice(lastIndex, match.index))
                );
            }

            const displayMathContent = match[1];  // from $$...$$
            const inlineMathContent = match[2];    // from $...$
            const mathSource = displayMathContent !== undefined
                ? displayMathContent
                : (inlineMathContent || '');
            const isDisplay = displayMathContent !== undefined;

            try {
                const mathEl = renderMath(mathSource, isDisplay);
                wrapper.appendChild(mathEl);
                hasMath = true;
            } catch {
                // Fallback: show raw text
                wrapper.appendChild(document.createTextNode(match[0]));
            }

            lastIndex = match.index + match[0].length;
        }

        // Add remaining plain text after the last math expression
        if (lastIndex < text.length) {
            wrapper.appendChild(
                document.createTextNode(text.slice(lastIndex))
            );
        }

        // If no math was found and no text was added, show the raw content
        if (lastIndex === 0 && !hasMath) {
            wrapper.textContent = text;
        }

        // CRITICAL: finishRenderMath() must be called AFTER the widget is
        // mounted in the document DOM. toDOM() is called before mounting,
        // so we defer the call.
        if (hasMath) {
            requestAnimationFrame(() => {
                try {
                    finishRenderMath();
                } catch {
                    // ignore
                }
            });
        }

        return wrapper;
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
                    // Replace the ENTIRE ~=...=~ range with MaskWidget.
                    // MaskWidget renders the content (incl. math) in a blur wrapper.
                    const maskContent = view.state.sliceDoc(ann.from, ann.to);
                    builder.add(ann.syntaxFrom, ann.syntaxTo,
                        Decoration.replace({ widget: new MaskWidget(maskContent) }));
                } else {
                    // Cursor inside: show raw syntax, just highlight content
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
            private annotations: Annotation[] = [];

            constructor(view: EditorView) {
                this.annotations = collectAnnotations(view);
                this.decorations = buildDecorations(view, this.annotations);
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.selectionSet
                ) {
                    this.annotations = collectAnnotations(update.view);
                    this.decorations = buildDecorations(update.view, this.annotations);
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

            // Comment tooltip
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
                                const prefixEnd = ann.from;
                                const prefixStart = ann.syntaxFrom;
                                view.dispatch({
                                    changes: {
                                        from: prefixStart,
                                        to: prefixEnd,
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

    return [annotationViewPlugin, hoverHandler];
}
