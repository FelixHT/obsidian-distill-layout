import { App, PluginSettingTab, Setting } from 'obsidian';
import type DistillLayoutPlugin from './main';
import type { DistillLayoutSettings } from './types';
import { PRESETS } from './presets';

const CSS_VAR_MAP: Record<string, string> = {
	tocWidth: '--distill-toc-width',
	tocFontSize: '--distill-toc-font-size',
	sidenoteWidth: '--distill-sidenote-width',
	sidenoteFontSize: '--distill-sidenote-font-size',
	sidenoteBackgroundColor: '--distill-sidenote-bg',
	sidenoteTextColor: '--distill-sidenote-text',
	sidenoteBorderColor: '--distill-sidenote-border',
	gutterWidth: '--distill-gutter-width',
	collapseWidth: '--distill-collapse-width',
	sidenoteFontFamily: '--distill-sidenote-font',
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
	}
	if (settings.sidenoteTextColor) {
		root.style.setProperty('--distill-sidenote-text', settings.sidenoteTextColor);
	}
	if (settings.sidenoteBorderColor) {
		root.style.setProperty('--distill-sidenote-border', settings.sidenoteBorderColor);
	}
	// 3b: Sidenote font family
	if (settings.sidenoteFontFamily) {
		root.style.setProperty('--distill-sidenote-font', settings.sidenoteFontFamily);
	} else {
		root.style.removeProperty('--distill-sidenote-font');
	}
}

export function removeCSSVariables(): void {
	const root = document.documentElement;
	for (const cssVar of Object.values(CSS_VAR_MAP)) {
		root.style.removeProperty(cssVar);
	}
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

		// ── Style Presets ──
		new Setting(containerEl)
			.setName('Style preset')
			.setDesc('Apply a one-click theme. Manual changes switch back to Custom.')
			.addDropdown(d => d
				.addOption('custom', 'Custom')
				.addOption('tufte', 'Tufte')
				.addOption('academic', 'Academic')
				.addOption('minimal', 'Minimal')
				.addOption('dark-accent', 'Dark Accent')
				.setValue(this.plugin.settings.stylePreset)
				.onChange(async v => {
					const preset = PRESETS[v];
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

		// ── TOC ──
		containerEl.createEl('h3', { text: 'Table of Contents' });

		new Setting(containerEl)
			.setName('Enable TOC')
			.setDesc('Show scroll-tracking table of contents in the left margin.')
			.addToggle(t => t
				.setValue(this.plugin.settings.tocEnabled)
				.onChange(async v => { this.plugin.settings.tocEnabled = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('TOC width')
			.setDesc('Width of the TOC column in pixels.')
			.addSlider(s => s
				.setLimits(120, 300, 10)
				.setValue(this.plugin.settings.tocWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.tocWidth = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Max heading depth')
			.setDesc('Maximum heading level to include (1 = H1 only, 3 = H1-H3, etc.).')
			.addSlider(s => s
				.setLimits(1, 6, 1)
				.setValue(this.plugin.settings.tocMaxDepth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.tocMaxDepth = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('TOC font size')
			.setDesc('Font size as a percentage.')
			.addSlider(s => s
				.setLimits(60, 120, 5)
				.setValue(this.plugin.settings.tocFontSize)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.tocFontSize = v; await this.save(); })
			);

		// ── Sidenotes ──
		containerEl.createEl('h3', { text: 'Sidenotes' });

		new Setting(containerEl)
			.setName('Enable sidenotes')
			.setDesc('Show footnotes as margin sidenotes in the right column.')
			.addToggle(t => t
				.setValue(this.plugin.settings.sidenotesEnabled)
				.onChange(async v => { this.plugin.settings.sidenotesEnabled = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Sidenote width')
			.setDesc('Width of the sidenote column in pixels.')
			.addSlider(s => s
				.setLimits(150, 350, 10)
				.setValue(this.plugin.settings.sidenoteWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.sidenoteWidth = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Sidenote font size')
			.setDesc('Font size as a percentage.')
			.addSlider(s => s
				.setLimits(60, 120, 5)
				.setValue(this.plugin.settings.sidenoteFontSize)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.sidenoteFontSize = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Hide footnotes section')
			.setDesc('Hide the original footnotes section at the bottom of the document.')
			.addToggle(t => t
				.setValue(this.plugin.settings.hideFootnotesSection)
				.onChange(async v => { this.plugin.settings.hideFootnotesSection = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Custom syntax {>text}')
			.setDesc('Enable inline sidenote syntax: {>your sidenote text}.')
			.addToggle(t => t
				.setValue(this.plugin.settings.customSidenoteSyntax)
				.onChange(async v => { this.plugin.settings.customSidenoteSyntax = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Show sidenote numbers')
			.setDesc('Show superscript numbers on footnote sidenotes. Margin notes ({>text}) are always unnumbered.')
			.addToggle(t => t
				.setValue(this.plugin.settings.showSidenoteNumbers)
				.onChange(async v => { this.plugin.settings.showSidenoteNumbers = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Collapsible sidenotes')
			.setDesc('Truncate long sidenotes with a fade-out and expand button.')
			.addToggle(t => t
				.setValue(this.plugin.settings.collapsibleSidenotes)
				.onChange(async v => { this.plugin.settings.collapsibleSidenotes = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Collapse height')
			.setDesc('Height threshold (px) above which sidenotes collapse.')
			.addSlider(s => s
				.setLimits(50, 300, 10)
				.setValue(this.plugin.settings.sidenoteCollapseHeight)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.sidenoteCollapseHeight = v; await this.save(); })
			);

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		// ── Layout ──
		containerEl.createEl('h3', { text: 'Layout' });

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName('Enable in edit mode')
			.setDesc('Show TOC and sidenotes in source and live preview mode.')
			.addToggle(t => t
				.setValue(this.plugin.settings.enableInEditMode)
				.onChange(async v => { this.plugin.settings.enableInEditMode = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Gutter width')
			.setDesc('Space between main content and margin columns (px).')
			.addSlider(s => s
				.setLimits(8, 48, 4)
				.setValue(this.plugin.settings.gutterWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.gutterWidth = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Collapse width')
			.setDesc('Pane width (px) below which columns collapse to inline mode.')
			.addSlider(s => s
				.setLimits(600, 1400, 50)
				.setValue(this.plugin.settings.collapseWidth)
				.setDynamicTooltip()
				.onChange(async v => { this.plugin.settings.collapseWidth = v; await this.save(); })
			);

		// ── Behavior ──
		containerEl.createEl('h3', { text: 'Behavior' });

		new Setting(containerEl)
			.setName('Smooth scroll')
			.setDesc('Use smooth scrolling when clicking TOC items.')
			.addToggle(t => t
				.setValue(this.plugin.settings.smoothScroll)
				.onChange(async v => { this.plugin.settings.smoothScroll = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Cross-reference clicking')
			.setDesc('Click sidenote number to scroll to its reference, and vice versa.')
			.addToggle(t => t
				.setValue(this.plugin.settings.crossRefClickEnabled)
				.onChange(async v => { this.plugin.settings.crossRefClickEnabled = v; await this.save(); })
			);

		new Setting(containerEl)
			.setName('Hover highlight')
			.setDesc('Hover over a sidenote to highlight its reference, and vice versa.')
			.addToggle(t => t
				.setValue(this.plugin.settings.hoverHighlight)
				.onChange(async v => { this.plugin.settings.hoverHighlight = v; await this.save(); })
			);
	}

	private async save(): Promise<void> {
		// Any manual change switches back to 'custom' preset
		if (this.plugin.settings.stylePreset !== 'custom') {
			this.plugin.settings.stylePreset = 'custom';
		}
		await this.plugin.saveSettings();
	}
}
