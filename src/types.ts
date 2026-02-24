/**
 * Annotation types for the plugin
 */

export interface CommentAnnotation {
    type: 'comment';
    /** Absolute position in the document — start of the visible text */
    from: number;
    /** Absolute position in the document — end of the visible text */
    to: number;
    /** The comment text to display on hover */
    comment: string;
    /** Start of the full syntax (including delimiters) */
    syntaxFrom: number;
    /** End of the full syntax (including delimiters) */
    syntaxTo: number;
}

export interface MaskAnnotation {
    type: 'mask';
    /** Absolute position in the document — start of the visible text */
    from: number;
    /** Absolute position in the document — end of the visible text */
    to: number;
    /** Start of the full syntax (including delimiters) */
    syntaxFrom: number;
    /** End of the full syntax (including delimiters) */
    syntaxTo: number;
}

export type Annotation = CommentAnnotation | MaskAnnotation;

export interface AnnotationPluginSettings {
    /** Highlight background color for comment annotations */
    commentHighlightColor: string;
    /** Mask blur amount in pixels */
    maskBlurAmount: number;
    /** Tooltip background color */
    tooltipBgColor: string;
    /** Tooltip text color */
    tooltipTextColor: string;
}

export const DEFAULT_SETTINGS: AnnotationPluginSettings = {
    commentHighlightColor: '#fff3a380',
    maskBlurAmount: 5,
    tooltipBgColor: '#1e1e2e',
    tooltipTextColor: '#cdd6f4',
};
