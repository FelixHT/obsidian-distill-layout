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
	collapsibleSidenotes: true,
	sidenoteCollapseHeight: 100,
	sidenoteDisplayMode: 'always',
numberBadgeStyle: 'superscript',
	sidenoteFontFamily: '',
	stylePreset: 'custom',
	enableInEditMode: false,
};

export interface HeadingEntry {
	id: string;
	text: string;
	level: number;
	element: HTMLElement;
	top: number;
}

export interface ParsedFootnote {
	id: string;
	refElement: HTMLElement;
	content: string;
	/** Rich HTML clone of the footnote content (li with backrefs removed). */
	contentEl?: HTMLElement;
	type?: 'sidenote' | 'marginnote';
}

export interface ColumnContainers {
	left: HTMLElement | null;
	right: HTMLElement | null;
}
