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
				.onChange(v => {
					const preset = PRESETS[v as keyof typeof PRESETS];
					if (preset) {
						Object.assign(this.plugin.settings, preset);
						this.plugin.settings.stylePreset = v as DistillLayoutSettings['stylePreset'];
						void this.plugin.saveSettings();
						this.display();
					} else {
						this.plugin.settings.stylePreset = 'custom';
						void this.plugin.saveSettings();
					}
				})
			);

		// ══════════════════════════════════════════
		// ── Table of Contents ──
		// ══════════════════════════════════════════
		const tocSection = createCollapsibleSection(containerEl, 'Table of Contents', true);

		new Setting(tocSection)
			.setName('Enable table of contents')
			.setDesc('Show scroll-tracking table of contents in the left margin.')
			.addToggle(t => t
				.setValue(this.plugin.settings.tocEnabled)
				.onChange(v => { this.plugin.settings.tocEnabled = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Table of contents width')
			.setDesc('Width of the table of contents column in pixels.')
			.addSlider(s => s
				.setLimits(120, 300, 10)
				.setValue(this.plugin.settings.tocWidth)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.tocWidth = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Max heading depth')
			.setDesc('Maximum heading level to include (1 = h1 only, 3 = h1-h3, etc.).')
			.addSlider(s => s
				.setLimits(1, 6, 1)
				.setValue(this.plugin.settings.tocMaxDepth)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.tocMaxDepth = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Table of contents font size')
			.setDesc('Font size as a percentage.')
			.addSlider(s => s
				.setLimits(60, 120, 5)
				.setValue(this.plugin.settings.tocFontSize)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.tocFontSize = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Reading progress bar')
			.setDesc('Show a thin progress bar above the table of contents indicating scroll position.')
			.addToggle(t => t
				.setValue(this.plugin.settings.progressBarEnabled)
				.onChange(v => { this.plugin.settings.progressBarEnabled = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Estimated reading time')
			.setDesc('Show word count and estimated reading time below the table of contents.')
			.addToggle(t => t
				.setValue(this.plugin.settings.readingTimeEnabled)
				.onChange(v => { this.plugin.settings.readingTimeEnabled = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Words per minute')
			.setDesc('Reading speed for time estimate.')
			.addSlider(s => s
				.setLimits(100, 400, 10)
				.setValue(this.plugin.settings.wordsPerMinute)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.wordsPerMinute = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Section previews on hover')
			.setDesc('Show a tooltip with the first few characters of each section when hovering table of contents items.')
			.addToggle(t => t
				.setValue(this.plugin.settings.tocPreviewsEnabled)
				.onChange(v => { this.plugin.settings.tocPreviewsEnabled = v; this.save(); })
			);

		new Setting(tocSection)
			.setName('Preview max characters')
			.setDesc('Maximum characters shown in section preview tooltips.')
			.addSlider(s => s
				.setLimits(60, 300, 10)
				.setValue(this.plugin.settings.tocPreviewMaxChars)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.tocPreviewMaxChars = v; this.save(); })
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
				.onChange(v => { this.plugin.settings.sidenotesEnabled = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote width')
			.setDesc('Width of the sidenote column in pixels.')
			.addSlider(s => s
				.setLimits(150, 350, 10)
				.setValue(this.plugin.settings.sidenoteWidth)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.sidenoteWidth = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote font size')
			.setDesc('Font size as a percentage.')
			.addSlider(s => s
				.setLimits(60, 120, 5)
				.setValue(this.plugin.settings.sidenoteFontSize)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.sidenoteFontSize = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Hide footnotes section')
			.setDesc('Hide the original footnotes section at the bottom of the document.')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideFootnotesSection)
				.onChange(v => { this.plugin.settings.hideFootnotesSection = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Custom syntax {>text}')
			.setDesc('Enable inline sidenote syntax: {>your sidenote text}.')
			.addToggle(t => t
				.setValue(this.plugin.settings.customSidenoteSyntax)
				.onChange(v => { this.plugin.settings.customSidenoteSyntax = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Show sidenote numbers')
			.setDesc('Show superscript numbers on footnote sidenotes. Margin notes ({>text}) are always unnumbered.')
			.addToggle(t => t
				.setValue(this.plugin.settings.showSidenoteNumbers)
				.onChange(v => { this.plugin.settings.showSidenoteNumbers = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote icons')
			.setDesc('Enable icon prefix syntax: {>!warning: text}. Supported: info, warning, tip, citation, question, note, example.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteIconsEnabled)
				.onChange(v => { this.plugin.settings.sidenoteIconsEnabled = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Collapsible sidenotes')
			.setDesc('Truncate long sidenotes with a fade-out and expand button.')
			.addToggle(t => t
				.setValue(this.plugin.settings.collapsibleSidenotes)
				.onChange(v => { this.plugin.settings.collapsibleSidenotes = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Collapse height')
			.setDesc('Height threshold (px) above which sidenotes collapse.')
			.addSlider(s => s
				.setLimits(50, 300, 10)
				.setValue(this.plugin.settings.sidenoteCollapseHeight)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.sidenoteCollapseHeight = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Display mode')
			.setDesc('Always: sidenotes always visible. Hover: sidenotes appear when hovering the reference.')
			.addDropdown(d => d
				.addOption('always', 'Always visible')
				.addOption('hover', 'Show on hover')
				.setValue(this.plugin.settings.sidenoteDisplayMode)
				.onChange(v => {
					this.plugin.settings.sidenoteDisplayMode = v as 'always' | 'hover';
					this.save();
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
				.onChange(v => {
					this.plugin.settings.numberBadgeStyle = v as 'superscript' | 'circled' | 'pill';
					this.save();
				})
			);

		new Setting(sidenoteSection)
			.setName('Animated entrance')
			.setDesc('Sidenotes and margin items animate in when scrolling into view.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteAnimations)
				.onChange(v => { this.plugin.settings.sidenoteAnimations = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Animation style')
			.setDesc('Type of entrance animation.')
			.addDropdown(d => d
				.addOption('fade', 'Fade')
				.addOption('slide', 'Slide')
				.setValue(this.plugin.settings.sidenoteAnimationStyle)
				.onChange(v => {
					this.plugin.settings.sidenoteAnimationStyle = v as 'fade' | 'slide';
					this.save();
				})
			);

		new Setting(sidenoteSection)
			.setName('Annotation highlight')
			.setDesc('Click a sidenote to highlight its source paragraph.')
			.addToggle(t => t
				.setValue(this.plugin.settings.annotationHighlight)
				.onChange(v => { this.plugin.settings.annotationHighlight = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Clickable links in sidenotes')
			.setDesc('Make wikilinks inside sidenotes clickable to open the linked note.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteLinksEnabled)
				.onChange(v => { this.plugin.settings.sidenoteLinksEnabled = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Show backlink indicators')
			.setDesc('Show an indicator when a linked note in a sidenote links back to the current note.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenoteBacklinks)
				.onChange(v => { this.plugin.settings.sidenoteBacklinks = v; this.save(); })
			);

		new Setting(sidenoteSection)
			.setName('Sidenote font family')
			.setDesc('Custom font for sidenotes (leave empty to inherit).')
			.addText(t => t
				.setPlaceholder('Georgia, serif')
				.setValue(this.plugin.settings.sidenoteFontFamily)
				.onChange(v => {
					this.plugin.settings.sidenoteFontFamily = v;
					this.save();
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
				.onChange(v => { this.plugin.settings.marginFiguresEnabled = v; this.save(); })
			);

		new Setting(marginSection)
			.setName('Figure max height')
			.setDesc('Maximum height (px) for margin figures.')
			.addSlider(s => s
				.setLimits(100, 400, 10)
				.setValue(this.plugin.settings.marginFigureMaxHeight)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.marginFigureMaxHeight = v; this.save(); })
			);

		new Setting(marginSection)
			.setName('Edit mode figure display')
			.setDesc('Where to show figures in edit/live-preview mode.')
			.addDropdown(d => d
				.addOption('margin-only', 'Margin only')
				.addOption('both', 'Both inline and margin')
				.addOption('inline-only', 'Inline only')
				.setValue(this.plugin.settings.editFigureDisplayMode)
				.onChange(v => {
					this.plugin.settings.editFigureDisplayMode = v as 'margin-only' | 'both' | 'inline-only';
					this.save();
				})
			);

		new Setting(marginSection)
			.setName('Margin code')
			.setDesc('Move ```margin-lang code blocks to the margin column.')
			.addToggle(t => t
				.setValue(this.plugin.settings.marginCodeEnabled)
				.onChange(v => { this.plugin.settings.marginCodeEnabled = v; this.save(); })
			);

		new Setting(marginSection)
			.setName('Code max lines')
			.setDesc('Maximum visible lines for margin code blocks.')
			.addSlider(s => s
				.setLimits(5, 30, 1)
				.setValue(this.plugin.settings.marginCodeMaxLines)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.marginCodeMaxLines = v; this.save(); })
			);

		new Setting(marginSection)
			.setName('Margin comments')
			.setDesc('Render {?text} or {?author|text} as comments in the margin.')
			.addToggle(t => t
				.setValue(this.plugin.settings.marginCommentsEnabled)
				.onChange(v => { this.plugin.settings.marginCommentsEnabled = v; this.save(); })
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
				.onChange(v => { this.plugin.settings.citationsEnabled = v; this.save(); })
			);

		new Setting(citationSection)
			.setName('Bibliography file path')
			.setDesc('Vault path to a .bib file (e.g., References.bib).')
			.addText(t => t
				.setPlaceholder('References.bib')
				.setValue(this.plugin.settings.citationBibPath)
				.onChange(v => {
					this.plugin.settings.citationBibPath = v;
					this.save();
				})
			);

		new Setting(citationSection)
			.setName('Citation style')
			.setDesc('How citations are formatted in the margin.')
			.addDropdown(d => d
				.addOption('author-year', 'Author-year')
				.addOption('numbered', 'Numbered')
				.setValue(this.plugin.settings.citationStyle)
				.onChange(v => {
					this.plugin.settings.citationStyle = v as 'author-year' | 'numbered';
					this.save();
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
				.onChange(v => { this.plugin.settings.dataviewMarginEnabled = v; this.save(); })
			);

		new Setting(integrationsSection)
			.setName('Multi-pane table of contents sync')
			.setDesc('Experimental. Sync table of contents highlighting across panes showing the same note.')
			.addToggle(t => t
				.setValue(this.plugin.settings.multiPaneSyncEnabled)
				.onChange(v => { this.plugin.settings.multiPaneSyncEnabled = v; this.save(); })
			);

		// ══════════════════════════════════════════
		// ── Colors ──
		// ══════════════════════════════════════════
		const colorSection = createCollapsibleSection(containerEl, 'Colors');

		new Setting(colorSection)
			.setName('Table of contents text color')
			.setDesc('Color for table of contents link text. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.tocColor || getThemeColor('--text-muted', '#888888'))
				.onChange(v => {
					this.plugin.settings.tocColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(() => {
					this.plugin.settings.tocColor = '';
					this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Table of contents highlight color')
			.setDesc('Color for the active table of contents item border and text. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.tocHighlightColor || getThemeColor('--text-accent', '#7f6df2'))
				.onChange(v => {
					this.plugin.settings.tocHighlightColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(() => {
					this.plugin.settings.tocHighlightColor = '';
					this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote number color')
			.setDesc('Color for sidenote numbers, badges, in-text references, and markers. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteNumberColor || getThemeColor('--text-accent', '#7f6df2'))
				.onChange(v => {
					this.plugin.settings.sidenoteNumberColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(() => {
					this.plugin.settings.sidenoteNumberColor = '';
					this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote text color')
			.setDesc('Color for sidenote body text. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteTextColor || getThemeColor('--text-muted', '#888888'))
				.onChange(v => {
					this.plugin.settings.sidenoteTextColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(() => {
					this.plugin.settings.sidenoteTextColor = '';
					this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote background color')
			.setDesc('Background color for sidenotes. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteBackgroundColor || getThemeColor('--background-secondary', '#f5f5f5'))
				.onChange(v => {
					this.plugin.settings.sidenoteBackgroundColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(() => {
					this.plugin.settings.sidenoteBackgroundColor = '';
					this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Sidenote border color')
			.setDesc('Border color for sidenotes. Clear to use theme default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.sidenoteBorderColor || getThemeColor('--background-modifier-border', '#ddd'))
				.onChange(v => {
					this.plugin.settings.sidenoteBorderColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(() => {
					this.plugin.settings.sidenoteBorderColor = '';
					this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Progress bar color')
			.setDesc('Color for the reading progress bar. Clear to use theme accent.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.progressBarColor || getThemeColor('--text-accent', '#7f6df2'))
				.onChange(v => {
					this.plugin.settings.progressBarColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to theme default')
				.onClick(() => {
					this.plugin.settings.progressBarColor = '';
					this.save();
					this.display();
				})
			);

		new Setting(colorSection)
			.setName('Margin comment color')
			.setDesc('Background color for margin comments. Clear to use default.')
			.addColorPicker(cp => cp
				.setValue(this.plugin.settings.marginCommentColor || '#fef3cd')
				.onChange(v => {
					this.plugin.settings.marginCommentColor = v;
					this.save();
				})
			)
			.addExtraButton(b => b
				.setIcon('reset')
				.setTooltip('Reset to default')
				.onClick(() => {
					this.plugin.settings.marginCommentColor = '';
					this.save();
					this.display();
				})
			);

		// ══════════════════════════════════════════
		// ── Layout ──
		// ══════════════════════════════════════════
		const layoutSection = createCollapsibleSection(containerEl, 'Layout');

		new Setting(layoutSection)
			.setName('Column layout')
			.setDesc('Default: table of contents left, sidenotes right. Swapped: reversed. Alternating: sidenotes on both sides.')
			.addDropdown(d => d
				.addOption('default', 'Default (left)')
				.addOption('swapped', 'Swapped (right)')
				.addOption('alternating', 'Alternating (both sides)')
				.setValue(this.plugin.settings.columnLayout)
				.onChange(v => {
					this.plugin.settings.columnLayout = v as 'default' | 'swapped' | 'alternating';
					this.save();
				})
			);

		new Setting(layoutSection)
			.setName('Enable in edit mode')
			.setDesc('Show table of contents and sidenotes in source and live preview mode.')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableInEditMode)
				.onChange(v => { this.plugin.settings.enableInEditMode = v; this.save(); })
			);

		new Setting(layoutSection)
			.setName('Gutter width')
			.setDesc('Space between main content and margin columns (px).')
			.addSlider(s => s
				.setLimits(8, 48, 4)
				.setValue(this.plugin.settings.gutterWidth)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.gutterWidth = v; this.save(); })
			);

		new Setting(layoutSection)
			.setName('Collapse width')
			.setDesc('Pane width (px) below which columns collapse to inline mode.')
			.addSlider(s => s
				.setLimits(600, 1400, 50)
				.setValue(this.plugin.settings.collapseWidth)
				.setDynamicTooltip()
				.onChange(v => { this.plugin.settings.collapseWidth = v; this.save(); })
			);

		// ══════════════════════════════════════════
		// ── Behavior ──
		// ══════════════════════════════════════════
		const behaviorSection = createCollapsibleSection(containerEl, 'Behavior');

		new Setting(behaviorSection)
			.setName('Smooth scroll')
			.setDesc('Use smooth scrolling when clicking table of contents items.')
			.addToggle(t => t
				.setValue(this.plugin.settings.smoothScroll)
				.onChange(v => { this.plugin.settings.smoothScroll = v; this.save(); })
			);

		new Setting(behaviorSection)
			.setName('Cross-reference clicking')
			.setDesc('Click sidenote number to scroll to its reference, and vice versa.')
			.addToggle(t => t
				.setValue(this.plugin.settings.crossRefClickEnabled)
				.onChange(v => { this.plugin.settings.crossRefClickEnabled = v; this.save(); })
			);

		new Setting(behaviorSection)
			.setName('Hover highlight')
			.setDesc('Hover over a sidenote to highlight its reference, and vice versa.')
			.addToggle(t => t
				.setValue(this.plugin.settings.hoverHighlight)
				.onChange(v => { this.plugin.settings.hoverHighlight = v; this.save(); })
			);

		new Setting(behaviorSection)
			.setName('Suppress footnote hover')
			.setDesc('Hide Obsidian\'s native footnote hover popover (content is already shown as sidenotes).')
			.addToggle(t => t
				.setValue(this.plugin.settings.suppressFootnoteHover)
				.onChange(v => { this.plugin.settings.suppressFootnoteHover = v; this.save(); })
			);

	}

	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	private save(): void {
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
