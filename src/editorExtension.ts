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
import { Annotation, MaskAnnotation, AnnotationPluginSettings } from './types';
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
function buildDecorations(view: EditorView, settings: AnnotationPluginSettings, annotations: Annotation[]): DecorationSet {
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
                    builder.add(ann.syntaxFrom, ann.from,
                        Decoration.replace({ widget: new HiddenMarkerWidget() }));
                    builder.add(ann.from, ann.to,
                        Decoration.mark({ class: 'annotation-mask' }));
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
 * Apply blur effect directly to DOM elements within mask ranges.
 *
 * CM6 mark decorations do NOT wrap around widget decorations (e.g. rendered
 * LaTeX). We query all widget-like elements in the editor's content DOM
 * and check if their document position falls within a mask range using
 * view.posAtDOM(). If so, we add the blur class directly.
 */
function applyDomMaskEffects(view: EditorView, annotations: Annotation[]): void {
    const masks = annotations.filter(a => a.type === 'mask') as MaskAnnotation[];

    // Clean up previously applied DOM-level mask classes
    view.dom.querySelectorAll('.annotation-mask-widget').forEach(el => {
        el.classList.remove('annotation-mask-widget');
    });

    if (masks.length === 0) return;

    let isLivePreview: boolean;
    try {
        isLivePreview = view.state.field(editorLivePreviewField);
    } catch {
        return;
    }
    if (!isLivePreview) return;

    // Build a list of active (non-cursor-inside) mask ranges
    const activeMasks = masks.filter(mask => {
        return !view.state.selection.ranges.some(
            range => range.from >= mask.syntaxFrom && range.to <= mask.syntaxTo
        );
    });
    if (activeMasks.length === 0) return;

    // Query ALL potential widget elements in the editor content DOM.
    // In Obsidian's CM6, rendered widgets (math, embeds, etc.) are typically:
    // - Elements with contenteditable="false"
    // - Elements with class cm-widget
    // - <mjx-container> tags
    // - Elements with .math, .MathJax, etc.
    const selectors = [
        '[contenteditable="false"]',
        '.cm-widget',
        '.cm-embed-block',
        'mjx-container',
        '.math',
        '.MathJax',
        '.internal-embed',
    ].join(', ');

    const widgetElements = Array.from(view.contentDOM.querySelectorAll(selectors));

    for (const widgetEl of widgetElements) {
        const htmlEl = widgetEl as HTMLElement;

        // Skip our own annotation elements
        if (htmlEl.classList.contains('annotation-mask') ||
            htmlEl.classList.contains('annotation-comment') ||
            htmlEl.classList.contains('annotation-mask-widget')) {
            continue;
        }

        try {
            const pos = view.posAtDOM(widgetEl as Node);

            // Check if this position falls within any active mask range
            for (const mask of activeMasks) {
                if (pos >= mask.from && pos <= mask.to) {
                    htmlEl.classList.add('annotation-mask-widget');
                    break;
                }
            }
        } catch {
            // posAtDOM can throw if the element is not in the editor
            // or has been removed — just skip it
        }
    }
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
                this.decorations = buildDecorations(view, settings, this.annotations);
                requestAnimationFrame(() => applyDomMaskEffects(view, this.annotations));
            }

            update(update: ViewUpdate) {
                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    update.selectionSet
                ) {
                    this.annotations = collectAnnotations(update.view);
                    this.decorations = buildDecorations(update.view, settings, this.annotations);
                    // Schedule DOM effects after CM6 has finished rendering
                    requestAnimationFrame(() => applyDomMaskEffects(update.view, this.annotations));
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
