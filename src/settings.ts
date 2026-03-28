import { App, PluginSettingTab, Setting } from 'obsidian';
import type DistillLayoutPlugin from './main';
import type { DistillLayoutSettings } from './types';
import { PRESETS } from './presets';

/** Read the actual computed value of a CSS variable from the current theme. */
function getThemeColor(cssVar: string, fallback: string): string {
	const val = getComputedStyle(document.body).getPropertyValue(cssVar).trim();
	if (!val) return fallback;
	if (val.startsWith('#')) return val;
	if (val.startsWith('rgb')) {
		const parts = val.match(/\d+/g);
		if (parts && parts.length >= 3) {
			const r = Number(parts[0]);
			const g = Number(parts[1]);
			const b = Number(parts[2]);
			return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
		}
	}
	return fallback;
}

const CSS_VAR_MAP: Record<string, string> = {
	tocWidth: '--distill-toc-width',
	tocFontSize: '--distill-toc-font-size',
	sidenoteWidth: '--distill-sidenote-width',
	sidenoteFontSize: '--distill-sidenote-font-size',
	sidenoteBackgroundColor: '--distill-sidenote-bg',
	sidenoteTextColor: '--distill-sidenote-text',
	sidenoteBorderColor: '--distill-sidenote-border',
	gutterWidth: '--distill-gutter-width',
	sidenoteFontFamily: '--distill-sidenote-font',
	tocColor: '--distill-toc-color',
	tocHighlightColor: '--distill-toc-highlight',
	sidenoteNumberColor: '--distill-sidenote-number-color',
	progressBarColor: '--distill-progress-bar-color',
	marginCommentColor: '--distill-comment-color',
	marginFigureMaxHeight: '--distill-figure-max-height',
};

export function applyCSSVariables(settings: DistillLayoutSettings): void {
	const root = document.documentElement;
	root.style.setProperty('--distill-toc-width', `${settings.tocWidth}px`);
	root.style.setProperty('--distill-toc-font-size', `${settings.tocFontSize}%`);
	root.style.setProperty('--distill-sidenote-width', `${settings.sidenoteWidth}px`);
	root.style.setProperty('--distill-sidenote-font-size', `${settings.sidenoteFontSize}%`);
	root.style.setProperty('--distill-gutter-width', `${settings.gutterWidth}px`);

	if (settings.sidenoteBackgroundColor) {
		root.style.setProperty('--distill-sidenote-bg', settings.sidenoteBackgroundColor);
	} else {
		root.style.removeProperty('--distill-sidenote-bg');
	}
	if (settings.sidenoteTextColor) {
		root.style.setProperty('--distill-sidenote-text', settings.sidenoteTextColor);
	} else {
		root.style.removeProperty('--distill-sidenote-text');
	}
	if (settings.sidenoteBorderColor) {
		root.style.setProperty('--distill-sidenote-border', settings.sidenoteBorderColor);
	} else {
		root.style.removeProperty('--distill-sidenote-border');
	}
	// Sidenote font family
	if (settings.sidenoteFontFamily) {
		root.style.setProperty('--distill-sidenote-font', settings.sidenoteFontFamily);
	} else {
		root.style.removeProperty('--distill-sidenote-font');
	}

	// Color customization
	if (settings.tocColor) {
		root.style.setProperty('--distill-toc-color', settings.tocColor);
	} else {
		root.style.removeProperty('--distill-toc-color');
	}
	if (settings.tocHighlightColor) {
		root.style.setProperty('--distill-toc-highlight', settings.tocHighlightColor);
	} else {
		root.style.removeProperty('--distill-toc-highlight');
	}
	if (settings.sidenoteNumberColor) {
		root.style.setProperty('--distill-sidenote-number-color', settings.sidenoteNumberColor);
	} else {
		root.style.removeProperty('--distill-sidenote-number-color');
	}

	// New CSS variables
	if (settings.progressBarColor) {
		root.style.setProperty('--distill-progress-bar-color', settings.progressBarColor);
	} else {
		root.style.removeProperty('--distill-progress-bar-color');
	}

	if (settings.marginCommentColor) {
		root.style.setProperty('--distill-comment-color', settings.marginCommentColor);
	} else {
		root.style.removeProperty('--distill-comment-color');
	}

	root.style.setProperty('--distill-figure-max-height', `${settings.marginFigureMaxHeight}px`);
}

export function removeCSSVariables(): void {
	const root = document.documentElement;
	for (const cssVar of Object.values(CSS_VAR_MAP)) {
		root.style.removeProperty(cssVar);
	}
}

/** Helper to create a collapsible section */
function createCollapsibleSection(containerEl: HTMLElement, title: string, open = false): HTMLElement {
	const details = containerEl.createEl('details', { cls: 'distill-settings-section' });
	if (open) details.setAttribute('open', '');
	details.createEl('summary', { text: title, cls: 'distill-settings-section-title' });
	return details;
}

export class DistillLayoutSettingTab extends PluginSettingTab {
	plugin: DistillLayoutPlugin;

	constructor(app: App, plugin: DistillLayoutPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Style Presets (always visible) ──
		new Setting(containerEl)
			.setName('Style preset')
			.setDesc('Apply a one-click theme. Manual changes switch back to custom.')
			.addDropdown(d => d
				.addOption('custom', 'Custom')
				.addOption('tufte', 'Tufte')
				.addOption('academic', 'Academic')
				.addOption('minimal', 'Minimal')
				.addOption('dark-accent', 'Dark accent')
				.setValue(this.plugin.settings.stylePreset)
				.onChange(async v => {
					const preset = PRESETS[v as keyof typeof PRESETS];
					if (preset) {
						Object.assign(this.plugin.settings, preset);
						this.plugin.settings.stylePreset = v as DistillLayoutSettings['stylePreset'];
						await this.plugin.saveSettings();
						this.display(); // Re-render settings to reflect new values
					} else {
						this.plugin.settings.stylePreset = 'custom';
						await this.plugin.saveSettings();
					}
				})
			);

		// ══════════════════════════════════════════
		// ── Table of Contents ──
		// ══════════════════════════════════════════
		const tocSection = createCollapsibleSection(containerEl, 'Table of Contents', true);

		new Setting(tocSection)
			.setName('Enable TOC')
			.setDesc('Show scroll-tracking table of contents in the left margin.')
			.addToggle(t => t
				.setValue(this.plugin.settings.tocEnabled)
				.onChange(async v => { this.plugin.settings.tocEnabled = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('TOC width')
			.setDesc('Width of the TOC column in pixels.')
			.addSlider(s => s
				.setLimits(120, 300, 10)
				.setValue(this.plugin.settings.tocWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.tocWidth = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('Max heading depth')
			.setDesc('Maximum heading level to include (1 = H1 only, 3 = H1-H3, etc.).')
			.addSlider(s => s
				.setLimits(1, 6, 1)
				.setValue(this.plugin.settings.tocMaxDepth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.tocMaxDepth = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('TOC font size')
			.setDesc('Font size as a percentage.')
			.addSlider(s => s
				.setLimits(60, 120, 5)
				.setValue(this.plugin.settings.tocFontSize)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.tocFontSize = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('Reading progress bar')
			.setDesc('Show a thin progress bar above the TOC indicating scroll position.')
			.addToggle(t => t
				.setValue(this.plugin.settings.progressBarEnabled)
				.onChange(async v => { this.plugin.settings.progressBarEnabled = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('Estimated reading time')
			.setDesc('Show word count and estimated reading time above the TOC.')
			.addToggle(t => t
				.setValue(this.plugin.settings.readingTimeEnabled)
				.onChange(async v => { this.plugin.settings.readingTimeEnabled = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('Words per minute')
			.setDesc('Reading speed for time estimate.')
			.addSlider(s => s
				.setLimits(100, 400, 10)
				.setValue(this.plugin.settings.wordsPerMinute)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.wordsPerMinute = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('Section previews on hover')
			.setDesc('Show a tooltip with the first few characters of each section when hovering TOC items.')
			.addToggle(t => t
				.setValue(this.plugin.settings.tocPreviewsEnabled)
				.onChange(async v => { this.plugin.settings.tocPreviewsEnabled = v; await this.save(); })
			);

		new Setting(tocSection)
			.setName('Preview max characters')
			.setDesc('Maximum characters shown in section preview tooltips.')
			.addSlider(s => s
				.setLimits(60, 300, 10)
				.setValue(this.plugin.settings.tocPreviewMaxChars)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.tocPreviewMaxChars = v; await this.save(); })
			);

		// ══════════════════════════════════════════
		// ── Sidenotes ──
		// ══════════════════════════════════════════
		const sidenoteSection = createCollapsibleSection(containerEl, 'Sidenotes', true);

		new Setting(sidenoteSection)
			.setName('Enable sidenotes')
			.setDesc('Show footnotes as margin sidenotes in the right column.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenotesEnabled)
				.onChange(async v => { this.plugin.settings.sidenotesEnabled = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote width')
			.setDesc('Width of the sidenote column in pixels.')
			.addSlider(s => s
				.setLimits(150, 350, 10)
				.setValue(this.plugin.settings.sidenoteWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.sidenoteWidth = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote font size')
			.setDesc('Font size as a percentage.')
			.addSlider(s => s
				.setLimits(60, 120, 5)
				.setValue(this.plugin.settings.sidenoteFontSize)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.sidenoteFontSize = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Hide footnotes section')
			.setDesc('Hide the original footnotes section at the bottom of the document.')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideFootnotesSection)
				.onChange(async v => { this.plugin.settings.hideFootnotesSection = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Custom syntax {>text}')
			.setDesc('Enable inline sidenote syntax: {>your sidenote text}.')
			.addToggle(t => t
				.setValue(this.plugin.settings.customSidenoteSyntax)
				.onChange(async v => { this.plugin.settings.customSidenoteSyntax = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Show sidenote numbers')
			.setDesc('Show superscript numbers on footnote sidenotes. Margin notes ({>text}) are always unnumbered.')
			.addToggle(t => t
				.setValue(this.plugin.settings.showSidenoteNumbers)
				.onChange(async v => { this.plugin.settings.showSidenoteNumbers = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote icons')
			.setDesc('Enable icon prefix syntax: {>!warning: text}. Supported: info, warning, tip, citation, question, note, example.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteIconsEnabled)
				.onChange(async v => { this.plugin.settings.sidenoteIconsEnabled = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Collapsible sidenotes')
			.setDesc('Truncate long sidenotes with a fade-out and expand button.')
			.addToggle(t => t
				.setValue(this.plugin.settings.collapsibleSidenotes)
				.onChange(async v => { this.plugin.settings.collapsibleSidenotes = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Collapse height')
			.setDesc('Height threshold (px) above which sidenotes collapse.')
			.addSlider(s => s
				.setLimits(50, 300, 10)
				.setValue(this.plugin.settings.sidenoteCollapseHeight)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.sidenoteCollapseHeight = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Display mode')
			.setDesc('Always: sidenotes always visible. Hover: sidenotes appear when hovering the reference.')
			.addDropdown(d => d
				.addOption('always', 'Always visible')
				.addOption('hover', 'Show on hover')
				.setValue(this.plugin.settings.sidenoteDisplayMode)
				.onChange(async v => {
					this.plugin.settings.sidenoteDisplayMode = v as 'always' | 'hover';
					await this.save();
				})
			);

		new Setting(sidenoteSection)
			.setName('Number badge style')
			.setDesc('Visual style of the footnote reference numbers.')
			.addDropdown(d => d
				.addOption('superscript', 'Superscript (default)')
				.addOption('circled', 'Circled')
				.addOption('pill', 'Pill')
				.setValue(this.plugin.settings.numberBadgeStyle)
				.onChange(async v => {
					this.plugin.settings.numberBadgeStyle = v as 'superscript' | 'circled' | 'pill';
					await this.save();
				})
			);

		new Setting(sidenoteSection)
			.setName('Animated entrance')
			.setDesc('Sidenotes and margin items animate in when scrolling into view.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteAnimations)
				.onChange(async v => { this.plugin.settings.sidenoteAnimations = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Animation style')
			.setDesc('Type of entrance animation.')
			.addDropdown(d => d
				.addOption('fade', 'Fade')
				.addOption('slide', 'Slide')
				.setValue(this.plugin.settings.sidenoteAnimationStyle)
				.onChange(async v => {
					this.plugin.settings.sidenoteAnimationStyle = v as 'fade' | 'slide';
					await this.save();
				})
			);

		new Setting(sidenoteSection)
			.setName('Annotation highlight')
			.setDesc('Click a sidenote to highlight its source paragraph.')
			.addToggle(t => t
				.setValue(this.plugin.settings.annotationHighlight)
				.onChange(async v => { this.plugin.settings.annotationHighlight = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Clickable links in sidenotes')
			.setDesc('Make wikilinks inside sidenotes clickable to open the linked note.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteLinksEnabled)
				.onChange(async v => { this.plugin.settings.sidenoteLinksEnabled = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Show backlink indicators')
			.setDesc('Show an indicator when a linked note in a sidenote links back to the current note.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteBacklinks)
				.onChange(async v => { this.plugin.settings.sidenoteBacklinks = v; await this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote font family')
			.setDesc('Custom font for sidenotes (leave empty to inherit).')
			.addText(t => t
				.setPlaceholder('e.g. Georgia, serif')
				.setValue(this.plugin.settings.sidenoteFontFamily)
				.onChange(async v => {
					this.plugin.settings.sidenoteFontFamily = v;
					await this.save();
				})
			);

		// ══════════════════════════════════════════
		// ── Margin Content ──
		// ══════════════════════════════════════════
		const marginSection = createCollapsibleSection(containerEl, 'Margin Content');

		new Setting(marginSection)
			.setName('Margin figures')
			.setDesc('Render {>fig:![[img]]|caption} as images in the margin.')
			.addToggle(t => t
				.setValue(this.plugin.settings.marginFiguresEnabled)
				.onChange(async v => { this.plugin.settings.marginFiguresEnabled = v; await this.save(); })
			);

		new Setting(marginSection)
			.setName('Figure max height')
			.setDesc('Maximum height (px) for margin figures.')
			.addSlider(s => s
				.setLimits(100, 400, 10)
				.setValue(this.plugin.settings.marginFigureMaxHeight)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.marginFigureMaxHeight = v; await this.save(); })
			);

		new Setting(marginSection)
			.setName('Edit mode figure display')
			.setDesc('Where to show figures in edit/live-preview mode.')
			.addDropdown(d => d
				.addOption('margin-only', 'Margin only')
				.addOption('both', 'Both inline and margin')
				.addOption('inline-only', 'Inline only')
				.setValue(this.plugin.settings.editFigureDisplayMode)
				.onChange(async v => {
					this.plugin.settings.editFigureDisplayMode = v as 'margin-only' | 'both' | 'inline-only';
					await this.save();
				})
			);

		new Setting(marginSection)
			.setName('Margin code')
			.setDesc('Move ```margin-lang code blocks to the margin column.')
			.addToggle(t => t
				.setValue(this.plugin.settings.marginCodeEnabled)
				.onChange(async v => { this.plugin.settings.marginCodeEnabled = v; await this.save(); })
			);

		new Setting(marginSection)
			.setName('Code max lines')
			.setDesc('Maximum visible lines for margin code blocks.')
			.addSlider(s => s
				.setLimits(5, 30, 1)
				.setValue(this.plugin.settings.marginCodeMaxLines)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.marginCodeMaxLines = v; await this.save(); })
			);

		new Setting(marginSection)
			.setName('Margin comments')
			.setDesc('Render {?text} or {?author|text} as comments in the margin.')
			.addToggle(t => t
				.setValue(this.plugin.settings.marginCommentsEnabled)
				.onChange(async v => { this.plugin.settings.marginCommentsEnabled = v; await this.save(); })
			);

		// ══════════════════════════════════════════
		// ── Citations ──
		// ══════════════════════════════════════════
		const citationSection = createCollapsibleSection(containerEl, 'Citations (Experimental)');

		new Setting(citationSection)
			.setName('Enable citations')
			.setDesc('Experimental. Parse [@citekey] syntax and show formatted references in the margin.')
			.addToggle(t => t
				.setValue(this.plugin.settings.citationsEnabled)
				.onChange(async v => { this.plugin.settings.citationsEnabled = v; await this.save(); })
			);

		new Setting(citationSection)
			.setName('BibTeX file path')
			.setDesc('Path to a .bib file in the vault (e.g. references.bib).')
			.addText(t => t
				.setPlaceholder('references.bib')
				.setValue(this.plugin.settings.citationBibPath)
				.onChange(async v => {
					this.plugin.settings.citationBibPath = v;
					await this.save();
				})
			);

		new Setting(citationSection)
			.setName('Citation style')
			.setDesc('How citations are formatted in the margin.')
			.addDropdown(d => d
				.addOption('author-year', 'Author-year')
				.addOption('numbered', 'Numbered')
				.setValue(this.plugin.settings.citationStyle)
				.onChange(async v => {
					this.plugin.settings.citationStyle = v as 'author-year' | 'numbered';
					await this.save();
				})
			);

		// ══════════════════════════════════════════
		// ── Integrations ──
		// ══════════════════════════════════════════
		const integrationsSection = createCollapsibleSection(containerEl, 'Integrations (Experimental)');

		new Setting(integrationsSection)
			.setName('Dataview margin blocks')
			.setDesc('Experimental. Render ```dataview-margin code blocks in the margin (requires Dataview plugin).')
			.addToggle(t => t
				.setValue(this.plugin.settings.dataviewMarginEnabled)
				.onChange(async v => { this.plugin.settings.dataviewMarginEnabled = v; await this.save(); })
			);

		new Setting(integrationsSection)
			.setName('Multi-pane TOC sync')
			.setDesc('Experimental. Sync TOC highlighting across panes showing the same note.')
			.addToggle(t => t
				.setValue(this.plugin.settings.multiPaneSyncEnabled)
				.onChange(async v => { this.plugin.settings.multiPaneSyncEnabled = v; await this.save(); })
			);

		// ══════════════════════════════════════════
		// ── Colors ──
		// ══════════════════════════════════════════
		const colorSection = createCollapsibleSection(containerEl, 'Colors');

		new Setting(colorSection)
			.setName('TOC text color')
			.setDesc('Color for TOC link text. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.tocColor || getThemeColor('--text-muted', '#888888'))
				.onChange(async v => {
					this.plugin.settings.tocColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(async () => {
					this.plugin.settings.tocColor = '';
					await this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('TOC highlight color')
			.setDesc('Color for the active TOC item border and text. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.tocHighlightColor || getThemeColor('--text-accent', '#7f6df2'))
				.onChange(async v => {
					this.plugin.settings.tocHighlightColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(async () => {
					this.plugin.settings.tocHighlightColor = '';
					await this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote number color')
			.setDesc('Color for sidenote numbers, badges, in-text references, and markers. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteNumberColor || getThemeColor('--text-accent', '#7f6df2'))
				.onChange(async v => {
					this.plugin.settings.sidenoteNumberColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(async () => {
					this.plugin.settings.sidenoteNumberColor = '';
					await this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote text color')
			.setDesc('Color for sidenote body text. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteTextColor || getThemeColor('--text-muted', '#888888'))
				.onChange(async v => {
					this.plugin.settings.sidenoteTextColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(async () => {
					this.plugin.settings.sidenoteTextColor = '';
					await this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote background color')
			.setDesc('Background color for sidenotes. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteBackgroundColor || getThemeColor('--background-secondary', '#f5f5f5'))
				.onChange(async v => {
					this.plugin.settings.sidenoteBackgroundColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(async () => {
					this.plugin.settings.sidenoteBackgroundColor = '';
					await this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote border color')
			.setDesc('Border color for sidenotes. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteBorderColor || getThemeColor('--background-modifier-border', '#ddd'))
				.onChange(async v => {
					this.plugin.settings.sidenoteBorderColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(async () => {
					this.plugin.settings.sidenoteBorderColor = '';
					await this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Progress bar color')
			.setDesc('Color for the reading progress bar. Clear to use theme accent.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.progressBarColor || getThemeColor('--text-accent', '#7f6df2'))
				.onChange(async v => {
					this.plugin.settings.progressBarColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(async () => {
					this.plugin.settings.progressBarColor = '';
					await this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Margin comment color')
			.setDesc('Background color for margin comments. Clear to use default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.marginCommentColor || '#fef3cd')
				.onChange(async v => {
					this.plugin.settings.marginCommentColor = v;
					await this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to default')
				.onClick(async () => {
					this.plugin.settings.marginCommentColor = '';
					await this.save();
					this.display();
				})
			);

		// ══════════════════════════════════════════
		// ── Layout ──
		// ══════════════════════════════════════════
		const layoutSection = createCollapsibleSection(containerEl, 'Layout');

		new Setting(layoutSection)
			.setName('Column layout')
			.setDesc('Default: TOC left, sidenotes right. Swapped: reversed. Alternating: sidenotes on both sides (no TOC).')
			.addDropdown(d => d
				.addOption('default', 'Default (TOC left)')
				.addOption('swapped', 'Swapped (TOC right)')
				.addOption('alternating', 'Alternating (both sides)')
				.setValue(this.plugin.settings.columnLayout)
				.onChange(async v => {
					this.plugin.settings.columnLayout = v as 'default' | 'swapped' | 'alternating';
					await this.save();
				})
			);

		new Setting(layoutSection)
			.setName('Enable in edit mode')
			.setDesc('Show TOC and sidenotes in source and live preview mode.')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableInEditMode)
				.onChange(async v => { this.plugin.settings.enableInEditMode = v; await this.save(); })
			);

		new Setting(layoutSection)
			.setName('Gutter width')
			.setDesc('Space between main content and margin columns (px).')
			.addSlider(s => s
				.setLimits(8, 48, 4)
				.setValue(this.plugin.settings.gutterWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.gutterWidth = v; await this.save(); })
			);

		new Setting(layoutSection)
			.setName('Collapse width')
			.setDesc('Pane width (px) below which columns collapse to inline mode.')
			.addSlider(s => s
				.setLimits(600, 1400, 50)
				.setValue(this.plugin.settings.collapseWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.collapseWidth = v; await this.save(); })
			);

		// ══════════════════════════════════════════
		// ── Behavior ──
		// ══════════════════════════════════════════
		const behaviorSection = createCollapsibleSection(containerEl, 'Behavior');

		new Setting(behaviorSection)
			.setName('Smooth scroll')
			.setDesc('Use smooth scrolling when clicking TOC items.')
			.addToggle(t => t
				.setValue(this.plugin.settings.smoothScroll)
				.onChange(async v => { this.plugin.settings.smoothScroll = v; await this.save(); })
			);

		new Setting(behaviorSection)
			.setName('Cross-reference clicking')
			.setDesc('Click sidenote number to scroll to its reference, and vice versa.')
			.addToggle(t => t
				.setValue(this.plugin.settings.crossRefClickEnabled)
				.onChange(async v => { this.plugin.settings.crossRefClickEnabled = v; await this.save(); })
			);

		new Setting(behaviorSection)
			.setName('Hover highlight')
			.setDesc('Hover over a sidenote to highlight its reference, and vice versa.')
			.addToggle(t => t
				.setValue(this.plugin.settings.hoverHighlight)
				.onChange(async v => { this.plugin.settings.hoverHighlight = v; await this.save(); })
			);

		new Setting(behaviorSection)
			.setName('Suppress footnote hover')
			.setDesc('Hide Obsidian\'s native footnote hover popover (content is already shown as sidenotes).')
			.addToggle(t => t
				.setValue(this.plugin.settings.suppressFootnoteHover)
				.onChange(async v => { this.plugin.settings.suppressFootnoteHover = v; await this.save(); })
			);

	}

	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	private async save(): Promise<void> {
		// Any manual change switches back to 'custom' preset
		if (this.plugin.settings.stylePreset !== 'custom') {
			this.plugin.settings.stylePreset = 'custom';
		}
		// Apply CSS variables immediately for visual feedback
		applyCSSVariables(this.plugin.settings);
		// Debounce the disk write and full refresh to avoid excessive I/O during drags
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.plugin.saveSettings().catch(e => console.error('Distill Layout: failed to save settings', e));
		}, 150);
	}
}
