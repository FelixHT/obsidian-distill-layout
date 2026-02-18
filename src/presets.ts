import type { DistillLayoutSettings } from './types';

/**
 * Style presets — each defines a partial settings override.
 * Applying a preset merges its values into the current settings.
 */
export const PRESETS: Record<string, Partial<DistillLayoutSettings>> = {
	tufte: {
		sidenoteFontFamily: 'et-book, Palatino, "Palatino Linotype", "Palatino LT STD", "Book Antiqua", Georgia, serif',
		sidenoteBackgroundColor: 'transparent',
		sidenoteBorderColor: 'transparent',
		numberBadgeStyle: 'superscript',
		sidenoteWidth: 260,
		sidenoteFontSize: 85,
		tocFontSize: 75,
	},
	academic: {
		sidenoteFontFamily: '"Times New Roman", Times, serif',
		sidenoteBackgroundColor: '',
		sidenoteBorderColor: '',
		numberBadgeStyle: 'circled',
		sidenoteWidth: 220,
		sidenoteFontSize: 80,
		tocFontSize: 80,
	},
	minimal: {
		sidenoteFontFamily: '',
		sidenoteBackgroundColor: 'transparent',
		sidenoteTextColor: '',
		sidenoteBorderColor: 'transparent',
		numberBadgeStyle: 'superscript',
		sidenoteWidth: 200,
		sidenoteFontSize: 80,
		tocFontSize: 75,
	},
	'dark-accent': {
		sidenoteFontFamily: '',
		sidenoteBackgroundColor: 'rgba(var(--text-accent-rgb, 120, 120, 200), 0.08)',
		sidenoteBorderColor: 'var(--text-accent)',
		numberBadgeStyle: 'pill',
		sidenoteWidth: 230,
		sidenoteFontSize: 85,
		tocFontSize: 80,
	},
};

export type PresetName = keyof typeof PRESETS | 'custom';
