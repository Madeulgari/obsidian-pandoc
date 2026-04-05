
/*
 * main.ts
 *
 * Initialises the plugin, adds command palette options, adds the settings UI
 * Markdown processing is done in renderer.ts and Pandoc invocation in pandoc.ts
 *
 */

import * as fs from 'fs';
import * as path from 'path';

import { Notice, Plugin, FileSystemAdapter, MarkdownView } from 'obsidian';
import { lookpath } from 'lookpath';
import { pandoc, inputExtensions, outputFormats, OutputFormat, needsLaTeX, needsPandoc } from './pandoc';
import * as YAML from 'yaml';
import * as temp from 'temp';

import render from './renderer';
import { applyPreprocess, extractKoreanMetadata } from './preprocess';
import PandocPluginSettingTab from './settings';
import { PandocPluginSettings, DEFAULT_SETTINGS, replaceFileExtension } from './global';
export default class PandocPlugin extends Plugin {
    settings: PandocPluginSettings;
    features: { [key: string]: string | undefined } = {};

    async onload() {
        console.log('Loading Pandoc plugin');
        await this.loadSettings();

        // Check if Pandoc, LaTeX, etc. are installed and in the PATH
        this.createBinaryMap();

        // Register all of the command palette entries
        this.registerCommands();

        this.addSettingTab(new PandocPluginSettingTab(this.app, this));
    }

    registerCommands() {
        for (let [prettyName, pandocFormat, extension, shortName] of outputFormats) {

            const name = 'Export as ' + prettyName;
            this.addCommand({
                id: 'pandoc-export-' + pandocFormat, name,
                checkCallback: (checking: boolean) => {
                    if (!this.app.workspace.activeLeaf) return false;
                    if (!this.currentFileCanBeExported(pandocFormat as OutputFormat)) return false;
                    if (!checking) {
                        this.startPandocExport(this.getCurrentFile(), pandocFormat as OutputFormat, extension, shortName);
                    }
                    return true;
                }
            });
        }
    }

    vaultBasePath(): string {
        return (this.app.vault.adapter as FileSystemAdapter).getBasePath();
    }

    getCurrentFile(): string | null {
        const fileData = this.app.workspace.getActiveFile();
        if (!fileData) return null;
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter)
            return adapter.getFullPath(fileData.path);
        return null;
    }

    currentFileCanBeExported(format: OutputFormat): boolean {
        // Is it an available output type?
        if (needsPandoc(format) && !this.features['pandoc']) return false;
        if (needsLaTeX(format) && !this.features['pdflatex']) return false;
        // Is it a supported input type?
        const file = this.getCurrentFile();
        if (!file) return false;
        for (const ext of inputExtensions) {
            if (file.endsWith(ext)) return true;
        }
        return false;
    }

    async createBinaryMap() {
        this.features['pandoc'] = this.settings.pandoc || await lookpath('pandoc');
        this.features['pdflatex'] = this.settings.pdflatex || await lookpath('pdflatex');
    }

    async startPandocExport(inputFile: string, format: OutputFormat, extension: string, shortName: string) {
        new Notice(`Exporting ${inputFile} to ${shortName}`);
        console.log(`[Pandoc] Exporting ${inputFile} to ${shortName}`);

        // Instead of using Pandoc to process the raw Markdown, we use Obsidian's
        // internal markdown renderer, and process the HTML it generates instead.
        // This allows us to more easily deal with Obsidian specific Markdown syntax.
        // However, we provide an option to use MD instead to use citations

        let outputFile: string = replaceFileExtension(inputFile, extension);
        if (this.settings.outputFolder) {
            const resolvedFolder = path.isAbsolute(this.settings.outputFolder)
                ? this.settings.outputFolder
                : path.resolve(this.vaultBasePath(), this.settings.outputFolder);
            outputFile = path.join(resolvedFolder, path.basename(outputFile));
        }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        
        try {
            let error, command;

            switch (this.settings.exportFrom) {
                case 'html': {
                    const { html, metadata } = await render(this, view, inputFile, format);

                    if (format === 'html') {
                        // Write to HTML file
                        await fs.promises.writeFile(outputFile, html);
                        new Notice('Successfully exported via Pandoc to ' + outputFile);
                        console.log('[Pandoc] Successfully exported to ' + outputFile);
                        return;
                    } else {
                        // Spawn Pandoc
                        const metadataFile = temp.path();
                        const metadataString = YAML.stringify(metadata);
                        await fs.promises.writeFile(metadataFile, metadataString);
                        const result = await pandoc(
                            {
                                file: 'STDIN', contents: html, format: 'html', metadataFile,
                                pandoc: this.settings.pandoc, pdflatex: this.settings.pdflatex,
                                directory: path.dirname(inputFile),
                            },
                            { file: outputFile, format },
                            this.settings.extraArguments.split('\n')
                        );
                        error = result.error;
                        command = result.command;
                    }
                    break;
                }
                case 'md': {
                    const rawMarkdown = await fs.promises.readFile(inputFile, 'utf8');
                    const processedMarkdown = applyPreprocess(rawMarkdown, this.settings);

                    // Fix image paths using Obsidian's own file resolution,
                    // so attachments stored anywhere in the vault are found correctly.
                    const vaultBase = this.vaultBasePath();
                    const subfolder = inputFile.substring(vaultBase.length + 1);
                    const fixedMarkdown = processedMarkdown.replace(
                        /!\[([^\]]*)\]\(([^)]+)\)/g,
                        (_match, alt, src) => {
                            if (src.startsWith('http') || src.startsWith('data:')) return _match;
                            const decoded = decodeURIComponent(src);
                            // Strip any leading path — Obsidian resolves by filename
                            const filename = path.basename(decoded);
                            const file = this.app.metadataCache.getFirstLinkpathDest(filename, subfolder);
                            if (file) {
                                const resolved = path.join(vaultBase, file.path);
                                console.log('[Pandoc] Resolving image:', src, '→', resolved);
                                return `![${alt}](${resolved})`;
                            }
                            console.warn('[Pandoc] Could not resolve image:', src);
                            return _match;
                        }
                    );

                    const tempMdFile = temp.path({ suffix: '.md' });
                    await fs.promises.writeFile(tempMdFile, fixedMarkdown, 'utf8');

                    const baseName = path.basename(inputFile, path.extname(inputFile));
                    const mdMetadata: Record<string, any> = {};
                    if (this.settings.mapKoreanMetadata) {
                        const koreanMeta = extractKoreanMetadata(rawMarkdown);
                        if (koreanMeta.author) mdMetadata.author = koreanMeta.author;
                        if (koreanMeta.title) {
                            mdMetadata.title = koreanMeta.title;
                            mdMetadata.subtitle = baseName;
                        } else {
                            mdMetadata.title = baseName;
                        }
                    } else {
                        mdMetadata.title = baseName;
                    }
                    const mdMetadataFile = temp.path();
                    await fs.promises.writeFile(mdMetadataFile, YAML.stringify(mdMetadata));

                    const result = await pandoc(
                        {
                            file: tempMdFile, format: 'markdown',
                            pandoc: this.settings.pandoc, pdflatex: this.settings.pdflatex,
                            directory: path.dirname(inputFile),
                            metadataFile: mdMetadataFile,
                        },
                        { file: outputFile, format },
                        this.settings.extraArguments.split('\n')
                    );
                    // Clean up temp files (best-effort)
                    fs.promises.unlink(tempMdFile).catch(() => {});
                    fs.promises.unlink(mdMetadataFile).catch(() => {});
                    error = result.error;
                    command = result.command;
                    break;
                }
            }

            if (error.length) {
                new Notice('Exported via Pandoc to ' + outputFile + ' with warnings');
                new Notice('Pandoc warnings:' + error, 10000);
                console.warn('[Pandoc] Exported with warnings to ' + outputFile);
                console.warn('[Pandoc] Warnings:', error);
            } else {
                new Notice('Successfully exported via Pandoc to ' + outputFile);
                console.log('[Pandoc] Successfully exported to ' + outputFile);
            }
            if (this.settings.showCLICommands) {
                new Notice('Pandoc command: ' + command, 10000);
                console.log('[Pandoc] Command:', command);
            }

        } catch (e) {
            new Notice('Pandoc export failed: ' + e.toString(), 15000);
            console.error('[Pandoc] Export failed:', e);
        }
    }

    onunload() {
        console.log('Unloading Pandoc plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
