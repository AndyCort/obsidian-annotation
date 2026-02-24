import {
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { editorLivePreviewField } from 'obsidian';
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
                    // Hide the ~= and =~ markers
                    builder.add(ann.syntaxFrom, ann.from,
                        Decoration.replace({ widget: new HiddenMarkerWidget() }));
                    // Mark the content with annotation-mask class
                    builder.add(ann.from, ann.to,
                        Decoration.mark({
                            class: 'annotation-mask',
                            tagName: 'span',
                        }));
                    builder.add(ann.to, ann.syntaxTo,
                        Decoration.replace({ widget: new HiddenMarkerWidget() }));
                } else {
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
