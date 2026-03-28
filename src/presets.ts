import type { DistillLayoutSettings } from './types';

/**
 * Style presets — each defines a partial settings override.
 * Applying a preset merges its values into the current settings.
 */
export const PRESETS = {
	tufte: {
		sidenoteFontFamily: 'et-book, Palatino, "Palatino Linotype", "Palatino LT STD", "Book Antiqua", Georgia, serif',
		sidenoteBackgroundColor: 'transparent',
		sidenoteBorderColor: 'transparent',
		numberBadgeStyle: 'superscript',
		sidenoteWidth: 260,
		sidenoteFontSize: 85,
		tocFontSize: 75,
		sidenoteAnimations: false,
		sidenoteAnimationStyle: 'fade',
		sidenoteIconsEnabled: true,
		marginFiguresEnabled: true,
	},
	academic: {
		sidenoteFontFamily: '"Times New Roman", Times, serif',
		sidenoteBackgroundColor: '',
		sidenoteBorderColor: '',
		numberBadgeStyle: 'circled',
		sidenoteWidth: 220,
		sidenoteFontSize: 80,
		tocFontSize: 80,
		sidenoteAnimations: false,
		sidenoteIconsEnabled: true,
		citationsEnabled: false,
		marginFiguresEnabled: true,
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
		sidenoteAnimations: true,
		sidenoteAnimationStyle: 'fade',
		sidenoteIconsEnabled: false,
		progressBarEnabled: false,
		readingTimeEnabled: false,
	},
	'dark-accent': {
		sidenoteFontFamily: '',
		sidenoteBackgroundColor: 'rgba(var(--text-accent-rgb, 120, 120, 200), 0.08)',
		sidenoteBorderColor: 'var(--text-accent)',
		numberBadgeStyle: 'pill',
		sidenoteWidth: 230,
		sidenoteFontSize: 85,
		tocFontSize: 80,
		sidenoteAnimations: true,
		sidenoteAnimationStyle: 'slide',
		sidenoteIconsEnabled: true,
		progressBarEnabled: true,
	},
} as const satisfies Record<string, Partial<DistillLayoutSettings>>;

export type PresetName = 'custom' | keyof typeof PRESETS;
