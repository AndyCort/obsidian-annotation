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
    const isLivePreview = view.state.field(editorLivePreviewField);

    for (const ann of annotations) {
        if (ann.type === 'comment') {
            if (isLivePreview) {
                const cursorInside = view.state.selection.ranges.some(
                    range => range.from >= ann.syntaxFrom && range.to <= ann.syntaxTo
                );

                if (!cursorInside) {
                    builder.add(
                        ann.syntaxFrom,
                        ann.from,
                        Decoration.replace({ widget: new HiddenMarkerWidget() })
                    );

                    builder.add(
                        ann.from,
                        ann.to,
                        Decoration.mark({
                            class: 'annotation-comment',
                            attributes: { 'data-annotation-comment': ann.comment },
                        })
                    );

                    builder.add(
                        ann.to,
                        ann.syntaxTo,
                        Decoration.replace({ widget: new HiddenMarkerWidget() })
                    );
                } else {
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
                    builder.add(
                        ann.syntaxFrom,
                        ann.from,
                        Decoration.replace({ widget: new HiddenMarkerWidget() })
                    );

                    builder.add(
                        ann.from,
                        ann.to,
                        Decoration.mark({ class: 'annotation-mask' })
                    );

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
 * Apply blur effect directly to DOM elements within mask ranges.
 * This is necessary because CM6 mark decorations do NOT wrap around
 * widget decorations (e.g. rendered LaTeX). We must find those widget
 * DOM elements and apply the blur class to them directly.
 */
function applyDomMaskEffects(view: EditorView, annotations: Annotation[]): void {
    const masks = annotations.filter(a => a.type === 'mask') as MaskAnnotation[];
    const isLivePreview = view.state.field(editorLivePreviewField);

    // Clean up previously applied DOM-level mask classes
    view.dom.querySelectorAll('.annotation-mask-widget').forEach(el => {
        el.classList.remove('annotation-mask-widget');
    });

    if (!isLivePreview) return;

    for (const mask of masks) {
        const cursorInside = view.state.selection.ranges.some(
            range => range.from >= mask.syntaxFrom && range.to <= mask.syntaxTo
        );
        if (cursorInside) continue;

        try {
            // Walk through the DOM nodes within the mask range
            // and apply the blur class to any widget elements (e.g. rendered LaTeX)
            const startInfo = view.domAtPos(mask.from);
            const endInfo = view.domAtPos(mask.to);

            const startNode = startInfo.node;
            const endNode = endInfo.node;

            // Find the common line element (cm-line)
            const lineEl = view.dom.querySelector('.cm-line')
                ? getLineElement(startNode)
                : null;

            if (!lineEl) continue;

            // Walk all child elements of the line and check if they fall within the mask range
            const children = Array.from(lineEl.childNodes);
            let inRange = false;

            for (const child of children) {
                // Check if this node is or contains the start node
                if (child === startNode || child.contains(startNode)) {
                    inRange = true;
                }

                // If we're in range, check for widget elements that need blur
                if (inRange && child instanceof HTMLElement) {
                    // Obsidian renders math, embeds, etc. as widget elements
                    // These typically have classes like cm-embed-block, math, mjx-container, etc.
                    if (isWidgetElement(child)) {
                        child.classList.add('annotation-mask-widget');
                    }
                }

                // Check if this node is or contains the end node
                if (child === endNode || child.contains(endNode)) {
                    inRange = false;
                    break;
                }
            }
        } catch (e) {
            // Position might not be visible or DOM not ready
        }
    }
}

/**
 * Walk up the DOM tree to find the cm-line element.
 */
function getLineElement(node: Node): HTMLElement | null {
    let current: Node | null = node;
    while (current) {
        if (current instanceof HTMLElement && current.classList.contains('cm-line')) {
            return current;
        }
        current = current.parentNode;
    }
    return null;
}

/**
 * Check if an element is a CM6 widget (e.g. rendered LaTeX, embed, etc.)
 * that is NOT already our own annotation element.
 */
function isWidgetElement(el: HTMLElement): boolean {
    // Skip our own annotation spans
    if (el.classList.contains('annotation-mask') || el.classList.contains('annotation-comment')) {
        return false;
    }
    // Common widget/embed selectors in Obsidian's CM6 editor
    return (
        el.classList.contains('cm-embed-block') ||
        el.classList.contains('cm-widget') ||
        el.classList.contains('math') ||
        el.classList.contains('internal-embed') ||
        el.querySelector('mjx-container') !== null ||
        el.querySelector('.MathJax') !== null ||
        el.querySelector('.math') !== null ||
        el.tagName === 'MJX-CONTAINER'
    );
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
                // Schedule DOM mask effects after initial render
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
                    // Schedule DOM mask effects after CM6 has finished rendering
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
                    const ann = annotations.find(a => a.type === 'comment' && a.from <= pos && a.to >= pos) as any;

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
