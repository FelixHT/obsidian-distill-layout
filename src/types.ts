export interface DistillLayoutSettings {
	tocEnabled: boolean;
	tocWidth: number;
	tocMaxDepth: number;
	tocFontSize: number;
	sidenotesEnabled: boolean;
	sidenoteWidth: number;
	sidenoteFontSize: number;
	sidenoteBackgroundColor: string;
	sidenoteTextColor: string;
	sidenoteBorderColor: string;
	gutterWidth: number;
	collapseWidth: number;
	smoothScroll: boolean;
	hideFootnotesSection: boolean;
	customSidenoteSyntax: boolean;
	showSidenoteNumbers: boolean;
	/** Column layout: 'default' = TOC left / sidenotes right, 'swapped' = reversed, 'alternating' = odd left even right */
	columnLayout: 'default' | 'swapped' | 'alternating';
	/** Click sidenote number to scroll to ref and vice versa */
	crossRefClickEnabled: boolean;
	/** Hover sidenote highlights ref, hover ref highlights sidenote */
	hoverHighlight: boolean;
	/** Suppress Obsidian's native footnote hover popover (since sidenotes show the content) */
	suppressFootnoteHover: boolean;
	/** Collapse long sidenotes with a fade-out and expand button */
	collapsibleSidenotes: boolean;
	/** Height threshold (px) above which sidenotes collapse */
	sidenoteCollapseHeight: number;
	/** Display mode: 'always' shows all sidenotes, 'hover' shows on ref hover */
	sidenoteDisplayMode: 'always' | 'hover';
	/** Badge style for footnote reference numbers */
	numberBadgeStyle: 'superscript' | 'circled' | 'pill';
	/** Custom font family for sidenotes (empty = inherit) */
	sidenoteFontFamily: string;
	/** Active style preset ('custom' when settings are manually adjusted) */
	stylePreset: 'custom' | 'tufte' | 'academic' | 'minimal' | 'dark-accent';
	/** Show TOC and sidenotes in edit mode (experimental) */
	enableInEditMode: boolean;
	/** Custom color for TOC link text (empty = theme default) */
	tocColor: string;
	/** Custom color for active TOC item highlight (empty = theme default) */
	tocHighlightColor: string;
	/** Custom color for sidenote numbers, badges, and markers (empty = theme default) */
	sidenoteNumberColor: string;

	// ── Reading Progress Bar ──
	progressBarEnabled: boolean;
	progressBarColor: string;

	// ── Reading Time ──
	readingTimeEnabled: boolean;
	wordsPerMinute: number;

	// ── TOC Section Previews ──
	tocPreviewsEnabled: boolean;
	tocPreviewMaxChars: number;

	// ── Annotation Highlighting ──
	annotationHighlight: boolean;

	// ── Sidenote Animations ──
	sidenoteAnimations: boolean;
	sidenoteAnimationStyle: 'fade' | 'slide';

	// ── Multi-pane Sync ──
	multiPaneSyncEnabled: boolean;

	// ── Margin Figures ──
	marginFiguresEnabled: boolean;
	marginFigureMaxHeight: number;
	/** Where to show figures in edit/live-preview mode */
	editFigureDisplayMode: 'margin-only' | 'both' | 'inline-only';

	// ── Margin Code ──
	marginCodeEnabled: boolean;
	marginCodeMaxLines: number;

	// ── Margin Comments ──
	marginCommentsEnabled: boolean;
	marginCommentColor: string;

	// ── Citations ──
	citationsEnabled: boolean;
	citationBibPath: string;
	citationStyle: 'author-year' | 'numbered';

	// ── Dataview Integration ──
	dataviewMarginEnabled: boolean;

	// ── Sidenote Icons ──
	sidenoteIconsEnabled: boolean;

	// ── Bi-directional Sidenote Links ──
	sidenoteLinksEnabled: boolean;
	sidenoteBacklinks: boolean;
}

export const DEFAULT_SETTINGS: DistillLayoutSettings = {
	tocEnabled: true,
	tocWidth: 180,
	tocMaxDepth: 3,
	tocFontSize: 80,
	sidenotesEnabled: true,
	sidenoteWidth: 220,
	sidenoteFontSize: 85,
	sidenoteBackgroundColor: 'transparent',
	sidenoteTextColor: '',
	sidenoteBorderColor: '',
	gutterWidth: 20,
	collapseWidth: 900,
	smoothScroll: true,
	hideFootnotesSection: true,
	customSidenoteSyntax: true,
	showSidenoteNumbers: true,
	columnLayout: 'default',
	crossRefClickEnabled: true,
	hoverHighlight: true,
	suppressFootnoteHover: true,
	collapsibleSidenotes: true,
	sidenoteCollapseHeight: 100,
	sidenoteDisplayMode: 'always',
	numberBadgeStyle: 'superscript',
	sidenoteFontFamily: '',
	stylePreset: 'custom',
	enableInEditMode: false,
	tocColor: '',
	tocHighlightColor: '',
	sidenoteNumberColor: '',

	// New feature defaults
	progressBarEnabled: false,
	progressBarColor: '',
	readingTimeEnabled: false,
	wordsPerMinute: 230,
	tocPreviewsEnabled: false,
	tocPreviewMaxChars: 120,
	annotationHighlight: true,
	sidenoteAnimations: false,
	sidenoteAnimationStyle: 'fade',
	multiPaneSyncEnabled: false,
	marginFiguresEnabled: true,
	marginFigureMaxHeight: 200,
	editFigureDisplayMode: 'both',
	marginCodeEnabled: true,
	marginCodeMaxLines: 15,
	marginCommentsEnabled: true,
	marginCommentColor: '',
	citationsEnabled: false,
	citationBibPath: '',
	citationStyle: 'author-year',
	dataviewMarginEnabled: false,
	sidenoteIconsEnabled: true,
	sidenoteLinksEnabled: true,
	sidenoteBacklinks: false,
};

export interface HeadingEntry {
	id: string;
	text: string;
	level: number;
	element: HTMLElement;
	top: number;
	/** Source line number for scroll-to when heading is virtualized. */
	line?: number;
}

export interface ParsedFootnote {
	id: string;
	refElement: HTMLElement;
	content: string;
	/** Rich HTML clone of the footnote content (li with backrefs removed). */
	contentEl?: HTMLElement;
	type?: 'sidenote' | 'marginnote';
	/** Icon name for sidenote icon prefix (e.g. 'warning', 'info') */
	icon?: string;
}

export interface MarginItem {
	element: HTMLElement;
	refElement: HTMLElement;
	type: 'sidenote' | 'marginnote' | 'figure' | 'code' | 'comment' | 'citation' | 'dataview';
	id: string;
	column: 'left' | 'right';
}

export interface ColumnContainers {
	left: HTMLElement | null;
	right: HTMLElement | null;
}
