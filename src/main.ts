import { Plugin } from 'obsidian';
import { AnnotationPluginSettings, DEFAULT_SETTINGS } from './types';
import { createAnnotationEditorExtension } from './editorExtension';
import { annotationPostProcessor } from './postProcessor';
import { AnnotationSettingTab } from './settings';

export default class AnnotationPlugin extends Plugin {
    settings: AnnotationPluginSettings = DEFAULT_SETTINGS;
    private styleEl: HTMLStyleElement | null = null;

    async onload() {
        await this.loadSettings();

        // Register CodeMirror 6 editor extension for live preview / source mode
        this.registerEditorExtension(
            createAnnotationEditorExtension(this.settings)
        );

        // Register markdown post-processor for reading view
        this.registerMarkdownPostProcessor(annotationPostProcessor);

        // Add settings tab
        this.addSettingTab(new AnnotationSettingTab(this.app, this));

        // Inject dynamic CSS custom properties
        this.updateStyles();

        // Add commands
        this.addCommand({
            id: 'add-mask-to-selection',
            name: 'Add Mask to selection',
            editorCallback: (editor) => {
                const selection = editor.getSelection();
                editor.replaceSelection(`~=${selection}=~`);
            }
        });

        this.addCommand({
            id: 'add-comment-to-selection',
            name: 'Add Comment to selection',
            editorCallback: (editor) => {
                const selection = editor.getSelection();
                // Insert the prefix and suffix around the selection
                editor.replaceSelection(`=${selection}::批注=`);

                // Optional: Move cursor back to the "批注" text so they can edit it immediately
                const cursor = editor.getCursor();
                // Total backwards move needed: 3 (1 for "=", 2 for "批注")
                editor.setCursor({
                    line: cursor.line,
                    ch: cursor.ch - 3
                });

                // Select the "批注" placeholder
                editor.setSelection(
                    { line: cursor.line, ch: cursor.ch - 3 },
                    { line: cursor.line, ch: cursor.ch - 1 }
                );
            }
        });

        console.log('Annotation plugin loaded');
    }

    onunload() {
        // Remove dynamic styles
        if (this.styleEl) {
            this.styleEl.remove();
            this.styleEl = null;
        }
        console.log('Annotation plugin unloaded');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Inject/update a <style> element with CSS custom properties derived
     * from the current settings, so that styles.css can reference them.
     */
    updateStyles(): void {
        if (!this.styleEl) {
            this.styleEl = document.createElement('style');
            this.styleEl.id = 'annotation-plugin-dynamic-styles';
            document.head.appendChild(this.styleEl);
        }

        this.styleEl.textContent = `
			body {
				--annotation-highlight-color: ${this.settings.commentHighlightColor};
				--annotation-mask-blur: ${this.settings.maskBlurAmount}px;
				--annotation-tooltip-bg: ${this.settings.tooltipBgColor};
				--annotation-tooltip-text: ${this.settings.tooltipTextColor};
			}
		`;
    }
}
