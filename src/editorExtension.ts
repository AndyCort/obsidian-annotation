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
 * Build decorations for all visible annotations in the editor.
 */
function buildDecorations(view: EditorView, settings: AnnotationPluginSettings): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const isLivePreview = view.state.field(editorLivePreviewField);

    // Collect all annotations with their positions
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

    // Sort annotations by syntaxFrom to ensure correct ordering for RangeSetBuilder
    annotations.sort((a, b) => a.syntaxFrom - b.syntaxFrom);

    for (const ann of annotations) {
        if (ann.type === 'comment') {
            if (isLivePreview) {
                // Check if the cursor is inside the annotation syntax range
                const cursorInside = view.state.selection.ranges.some(
                    range => range.from >= ann.syntaxFrom && range.to <= ann.syntaxTo
                );

                if (!cursorInside) {
                    // Hide the opening "==comment::" prefix
                    builder.add(
                        ann.syntaxFrom,
                        ann.from,
                        Decoration.replace({ widget: new HiddenMarkerWidget() })
                    );

                    // Highlight the visible text
                    builder.add(
                        ann.from,
                        ann.to,
                        Decoration.mark({
                            class: 'annotation-comment',
                            attributes: { 'data-annotation-comment': ann.comment },
                        })
                    );

                    // Hide the closing "=="
                    builder.add(
                        ann.to,
                        ann.syntaxTo,
                        Decoration.replace({ widget: new HiddenMarkerWidget() })
                    );
                } else {
                    // Cursor inside — show the raw syntax but still highlight the text portion
                    builder.add(
                        ann.from,
                        ann.to,
                        Decoration.mark({
                            class: 'annotation-comment',
                            attributes: { 'data-annotation-comment': ann.comment },
                        })
                    );
                }
            } else {
                // Source mode: just highlight
                builder.add(
                    ann.from,
                    ann.to,
                    Decoration.mark({
                        class: 'annotation-comment',
                        attributes: { 'data-annotation-comment': ann.comment },
                    })
                );
            }
        } else if (ann.type === 'mask') {
            if (isLivePreview) {
                const cursorInside = view.state.selection.ranges.some(
                    range => range.from >= ann.syntaxFrom && range.to <= ann.syntaxTo
                );

                if (!cursorInside) {
                    // Hide opening "~="
                    builder.add(
                        ann.syntaxFrom,
                        ann.from,
                        Decoration.replace({ widget: new HiddenMarkerWidget() })
                    );

                    // Apply mask
                    builder.add(
                        ann.from,
                        ann.to,
                        Decoration.mark({ class: 'annotation-mask' })
                    );

                    // Hide closing "=~"
                    builder.add(
                        ann.to,
                        ann.syntaxTo,
                        Decoration.replace({ widget: new HiddenMarkerWidget() })
                    );
                } else {
                    builder.add(
                        ann.from,
                        ann.to,
                        Decoration.mark({ class: 'annotation-mask' })
                    );
                }
            } else {
                builder.add(
                    ann.from,
                    ann.to,
                    Decoration.mark({ class: 'annotation-mask' })
                );
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
                this.decorations = buildDecorations(view, settings);
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.selectionSet
                ) {
                    this.decorations = buildDecorations(update.view, settings);
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
                    showTooltip(comment, rect, document.body);
                }
            }
        },
        mouseout(event: MouseEvent) {
            const target = event.target as HTMLElement;
            const related = event.relatedTarget as HTMLElement | null;

            // If we're leaving a comment annotation and not entering the tooltip
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
