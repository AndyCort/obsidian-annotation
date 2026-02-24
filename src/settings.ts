import { App, PluginSettingTab, Setting } from 'obsidian';
import type AnnotationPlugin from './main';
import { AnnotationPluginSettings } from './types';

export class AnnotationSettingTab extends PluginSettingTab {
    plugin: AnnotationPlugin;

    constructor(app: App, plugin: AnnotationPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Annotation Plugin Settings' });

        new Setting(containerEl)
            .setName('Comment highlight color')
            .setDesc('Background color for annotated text (supports alpha, e.g. #fff3a380)')
            .addText(text =>
                text
                    .setPlaceholder('#fff3a380')
                    .setValue(this.plugin.settings.commentHighlightColor)
                    .onChange(async (value) => {
                        this.plugin.settings.commentHighlightColor = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateStyles();
                    })
            );

        new Setting(containerEl)
            .setName('Mask blur amount')
            .setDesc('Blur amount in pixels for masked text')
            .addSlider(slider =>
                slider
                    .setLimits(1, 20, 1)
                    .setValue(this.plugin.settings.maskBlurAmount)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.maskBlurAmount = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateStyles();
                    })
            );

        new Setting(containerEl)
            .setName('Tooltip background color')
            .setDesc('Background color for the comment tooltip')
            .addText(text =>
                text
                    .setPlaceholder('#1e1e2e')
                    .setValue(this.plugin.settings.tooltipBgColor)
                    .onChange(async (value) => {
                        this.plugin.settings.tooltipBgColor = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateStyles();
                    })
            );

        new Setting(containerEl)
            .setName('Tooltip text color')
            .setDesc('Text color for the comment tooltip')
            .addText(text =>
                text
                    .setPlaceholder('#cdd6f4')
                    .setValue(this.plugin.settings.tooltipTextColor)
                    .onChange(async (value) => {
                        this.plugin.settings.tooltipTextColor = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateStyles();
                    })
            );

        // Syntax help section
        containerEl.createEl('h3', { text: 'Syntax Reference' });

        const syntaxHelp = containerEl.createEl('div', { cls: 'annotation-syntax-help' });
        syntaxHelp.createEl('p', {
            text: 'Comment: ==your comment::annotated text=='
        });
        syntaxHelp.createEl('p', {
            text: 'Mask: ~=hidden text=~'
        });
    }
}
