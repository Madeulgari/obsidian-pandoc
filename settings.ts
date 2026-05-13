
/*
 * settings.ts
 *
 * Creates the settings UI
 *
 */

import { App, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';
import PandocPlugin from './main';
import { PreprocessRule } from './global';

export default class PandocPluginSettingTab extends PluginSettingTab {
    plugin: PandocPlugin;
    errorMessages: { [key: string]: string } = {
        pandoc: "Pandoc is not installed or accessible on your PATH. This plugin's functionality will be limited.",
        latex: "LaTeX is not installed or accessible on your PATH. Please install it if you want PDF exports via LaTeX.",
    }

    constructor(app: App, plugin: PandocPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h3', {text: 'Pandoc Plugin'});

        const createError = (text: string) =>
            containerEl.createEl('p', { cls: 'pandoc-plugin-error', text });
        
        for (const binary in this.plugin.features) {
            const path = this.plugin.features[binary];
            if (path === undefined) {
                createError(this.errorMessages[binary]);
            }
        }

        new Setting(containerEl)
            .setName("Custom CSS file for HTML output")
            .setDesc("This local CSS file will be read and injected into HTML exports. Use an absolute path or a path relative to the vault.")
            .addText(text => text
                .setPlaceholder('File name')
                .setValue(this.plugin.settings.customCSSFile)
                .onChange(async (value: string) => {
                    if (!value.length) this.plugin.settings.customCSSFile = null;
                    else this.plugin.settings.customCSSFile = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Inject app CSS (HTML output only)")
            .setDesc("This applies app & plugin CSS to HTML exports, but the files become a little bigger.")
            .addDropdown(dropdown => dropdown
                .addOptions({
                    "current": "Current theme",
                    "none": "Neither theme",
                    "light": "Light theme",
                    "dark": "Dark theme",
                })
                .setValue(this.plugin.settings.injectAppCSS)
                .onChange(async (value: string) => {
                    this.plugin.settings.injectAppCSS = value as 'current' | 'none' | 'light' | 'dark';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Internal link processing")
            .setDesc("This controls how [[wiki-links]] are formatted. Doesn't affect HTML output.")
            .addDropdown(dropdown => dropdown
                .addOptions({
                    "text": "Turn into text",
                    "link": "Leave as links",
                    "strip": "Remove links",
                    "unchanged": "Leave unchanged",
                })
                .setValue(this.plugin.settings.linkStrippingBehaviour)
                .onChange(async (value: string) => {
                    this.plugin.settings.linkStrippingBehaviour = value as 'strip' | 'text' | 'link' | 'unchanged';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Export files from HTML or markdown?")
            .setDesc("Export from markdown, or from the HTML visible in Obsidian? HTML supports fancy plugin features, markdown supports Pandoc features like citations.")
            .addDropdown(dropdown => dropdown
                .addOptions({
                    "html": "HTML",
                    "md": "Markdown",
                })
                .setValue(this.plugin.settings.exportFrom)
                .onChange(async (value: string) => {
                    this.plugin.settings.exportFrom = value as 'html' | 'md';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Export folder")
            .setDesc("Absolute or relative path to an export folder. Relative paths are resolved from the vault root (e.g. '../Pandoc'). If left blank, files are saved next to where they were exported from.")
            .addText(text => text
                .setPlaceholder('same as target')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async (value: string) => {
                    this.plugin.settings.outputFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Show Pandoc command line interface commands")
            .setDesc("Doesn't apply to HTML exports. Using the CLI will have slightly different results due to how this plugin works.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showCLICommands)
                .onChange(async (value: boolean) => {
                    this.plugin.settings.showCLICommands = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Pandoc path")
            .setDesc("Optional override for Pandoc's path if you have command not found issues. On Mac/Linux use the output of 'which pandoc' in a terminal; on Windows use the output of 'Get-Command pandoc' in powershell.")
            .addText(text => text
                .setPlaceholder('pandoc')
                .setValue(this.plugin.settings.pandoc)
                .onChange(async (value: string) => {
                    this.plugin.settings.pandoc = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("PDFLaTeX path")
            .setDesc("Optional override for pdflatex's path. Same as above but with 'which pdflatex'")
            .addText(text => text
                .setPlaceholder('pdflatex')
                .setValue(this.plugin.settings.pdflatex)
                .onChange(async (value: string) => {
                    this.plugin.settings.pdflatex = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Extra Pandoc arguments")
            .setDesc("Add extra command line arguments so you can use templates or bibliographies. Newlines are turned into spaces")
            .addTextArea(text => text
                .setPlaceholder('Example: --bibliography "Zotero Exports\My Library.json" or --template letter')
                .setValue(this.plugin.settings.extraArguments)
                .onChange(async (value: string) => {
                    this.plugin.settings.extraArguments = value;
                    await this.plugin.saveSettings();
                })
                .inputEl.style.minHeight='150px');

        // ── Pre-processing ──────────────────────────────────────────────────

        containerEl.createEl('h3', { text: 'Pre-processing' });
        containerEl.createEl('p', {
            text: 'These substitutions are applied to the markdown content in memory before export. The original file is never modified.',
            cls: 'setting-item-description',
        });

        new Setting(containerEl)
            .setName('Fix underscore italic syntax')
            .setDesc('Converts _text_ to *text* before export, fixing italic rendering issues with Korean and other non-Latin text.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.underscoreItalicFix)
                .onChange(async (value: boolean) => {
                    this.plugin.settings.underscoreItalicFix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Map Korean YAML metadata')
            .setDesc('Maps Korean frontmatter keys to Pandoc metadata. 제목 → title (원제), 파일명 → subtitle (번역 제목), 작가 → author (내부링크 자동 제거). 제목 없으면 파일명만 title로 사용.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.mapKoreanMetadata)
                .onChange(async (value: boolean) => {
                    this.plugin.settings.mapKoreanMetadata = value;
                    await this.plugin.saveSettings();
                }));

        // ── Metadata templates ──────────────────────────────────────────────

        containerEl.createEl('h4', { text: 'Metadata templates' });
        containerEl.createEl('p', {
            text: 'Free-form templates for Pandoc metadata fields. Available variables: {filename}, {h1}, {yaml:키}. If the resolved value is empty or the variable does not exist, the field is omitted.',
            cls: 'setting-item-description',
        });

        new Setting(containerEl)
            .setName('Title template')
            .setDesc('e.g. {yaml:제목} or {h1} or {filename}')
            .addText(text => text
                .setPlaceholder('{filename}')
                .setValue(this.plugin.settings.titleTemplate)
                .onChange(async (value: string) => {
                    this.plugin.settings.titleTemplate = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Subtitle template')
            .setDesc('e.g. {filename} or {yaml:파일명}')
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.subtitleTemplate)
                .onChange(async (value: string) => {
                    this.plugin.settings.subtitleTemplate = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Author template')
            .setDesc('e.g. {yaml:작가} (배열이면 전체 반환) or {yaml:저자}')
            .addText(text => text
                .setPlaceholder('{yaml:작가}')
                .setValue(this.plugin.settings.authorTemplate)
                .onChange(async (value: string) => {
                    this.plugin.settings.authorTemplate = value;
                    await this.plugin.saveSettings();
                }));

        // User-defined rules section
        containerEl.createEl('h4', { text: 'Custom find & replace rules' });

        const rulesContainer = containerEl.createDiv({ cls: 'pandoc-preprocess-rules' });
        const renderRules = () => {
            rulesContainer.empty();
            const rules = this.plugin.settings.preprocessRules;
            if (rules.length === 0) {
                rulesContainer.createEl('p', {
                    text: 'No rules defined.',
                    cls: 'setting-item-description',
                });
            }
            rules.forEach((rule: PreprocessRule, index: number) => {
                const row = rulesContainer.createDiv({ cls: 'pandoc-preprocess-rule-row' });
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.gap = '8px';
                row.style.marginBottom = '6px';

                // Enabled toggle
                const enabledToggle = row.createEl('input', { type: 'checkbox' } as any);
                (enabledToggle as HTMLInputElement).checked = rule.enabled;
                (enabledToggle as HTMLInputElement).title = 'Enable/disable this rule';
                enabledToggle.addEventListener('change', async () => {
                    rules[index].enabled = (enabledToggle as HTMLInputElement).checked;
                    await this.plugin.saveSettings();
                });

                // Find input
                const findInput = row.createEl('input', { type: 'text' } as any) as HTMLInputElement;
                findInput.placeholder = rule.isRegex ? 'Regex pattern' : 'Find';
                findInput.value = rule.find;
                findInput.style.flex = '1';
                findInput.addEventListener('change', async () => {
                    rules[index].find = findInput.value;
                    await this.plugin.saveSettings();
                });

                // Replace input
                const replaceInput = row.createEl('input', { type: 'text' } as any) as HTMLInputElement;
                replaceInput.placeholder = 'Replace with';
                replaceInput.value = rule.replace;
                replaceInput.style.flex = '1';
                replaceInput.addEventListener('change', async () => {
                    rules[index].replace = replaceInput.value;
                    await this.plugin.saveSettings();
                });

                // Regex toggle
                const regexLabel = row.createEl('label');
                regexLabel.style.display = 'flex';
                regexLabel.style.alignItems = 'center';
                regexLabel.style.gap = '4px';
                regexLabel.style.whiteSpace = 'nowrap';
                const regexCheckbox = regexLabel.createEl('input', { type: 'checkbox' } as any) as HTMLInputElement;
                regexCheckbox.checked = rule.isRegex;
                regexLabel.createSpan({ text: 'Regex' });
                regexCheckbox.addEventListener('change', async () => {
                    rules[index].isRegex = regexCheckbox.checked;
                    findInput.placeholder = regexCheckbox.checked ? 'Regex pattern' : 'Find';
                    await this.plugin.saveSettings();
                });

                // Delete button
                const deleteBtn = row.createEl('button', { text: '✕' });
                deleteBtn.title = 'Remove this rule';
                deleteBtn.addEventListener('click', async () => {
                    rules.splice(index, 1);
                    await this.plugin.saveSettings();
                    renderRules();
                });
            });
        };

        renderRules();

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText('+ Add rule')
                .onClick(async () => {
                    this.plugin.settings.preprocessRules.push({
                        find: '',
                        replace: '',
                        isRegex: false,
                        enabled: true,
                    });
                    await this.plugin.saveSettings();
                    renderRules();
                }));
    }
}
