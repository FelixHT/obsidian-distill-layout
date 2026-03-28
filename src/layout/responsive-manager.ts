import type { DistillLayoutSettings } from '../types';

/**
 * Monitors the leaf container width and toggles narrow mode
 * when the pane is below the collapse threshold.
 */
export class ResponsiveManager {
	private settings: DistillLayoutSettings;
	private observer: ResizeObserver | null = null;
	private currentTarget: HTMLElement | null = null;
	private currentMode: 'preview' | 'edit' = 'preview';
	private currentSourceView: HTMLElement | null = null;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
		// Re-check with new threshold
		if (this.currentTarget) {
			if (this.currentMode === 'edit' && this.currentSourceView) {
				this.checkEdit(this.currentTarget, this.currentSourceView);
			} else {
				this.check(this.currentTarget);
			}
		}
	}

	/**
	 * Start observing the leaf content element for size changes.
	 */
	observe(leafContent: HTMLElement): void {
		// Already observing the same element — just re-check, don't reconnect
		if (this.currentTarget === leafContent && this.observer) {
			this.check(leafContent);
			return;
		}

		this.disconnect();
		this.currentTarget = leafContent;
		this.currentMode = 'preview';
		this.currentSourceView = null;

		this.observer = new ResizeObserver(() => {
			this.check(leafContent);
		});
		this.observer.observe(leafContent);

		// Initial check
		this.check(leafContent);
	}

	private check(el: HTMLElement): void {
		const leafWidth = el.getBoundingClientRect().width;

		// Distill/Tufte approach: use existing margins from Obsidian's readable
		// line width. Collapse to inline only when margin is too small to be useful.
		// Use max-width constraint as the reference (not actual width) since content
		// may overflow the readable line width in some cases.
		const sizer = el.querySelector('.markdown-preview-sizer') as HTMLElement;
		let contentWidth = 0;
		if (sizer) {
			const maxW = getComputedStyle(sizer).maxWidth;
			contentWidth = maxW && maxW !== 'none' ? Math.min(parseFloat(maxW), leafWidth) : sizer.offsetWidth;
		}
		if (!contentWidth) {
			// Fallback: try CM content for edit mode
			const cmContent = el.querySelector('.cm-content') as HTMLElement;
			if (cmContent) {
				const maxW = getComputedStyle(cmContent).maxWidth;
				contentWidth = maxW && maxW !== 'none' ? Math.min(parseFloat(maxW), leafWidth) : cmContent.offsetWidth;
			}
		}

		// Minimum usable margin for any sidenote content (px)
		const MIN_USABLE_MARGIN = 120;

		let isNarrow: boolean;
		if (contentWidth > 0) {
			const marginAvailable = (leafWidth - contentWidth) / 2;
			isNarrow = marginAvailable < MIN_USABLE_MARGIN;
		} else {
			isNarrow = leafWidth < this.settings.collapseWidth;
		}

		el.classList.toggle('distill-narrow', isNarrow);

		// When not narrow, set column and sidenote widths to fit the available margin.
		if (!isNarrow && contentWidth > 0) {
			const marginAvailable = Math.floor((leafWidth - contentWidth) / 2);
			const gutter = this.settings.gutterWidth;
			const effectiveWidth = Math.max(MIN_USABLE_MARGIN, marginAvailable - gutter);
			// Column containers span the full margin (flush with window edge)
			el.style.setProperty('--distill-margin-left', `${marginAvailable}px`);
			el.style.setProperty('--distill-margin-right', `${marginAvailable}px`);
			// Sidenote content uses effective width (margin minus gutter)
			el.style.setProperty('--distill-effective-sidenote-width', `${effectiveWidth}px`);
			el.style.setProperty('--distill-effective-toc-width', `${Math.min(this.settings.tocWidth, effectiveWidth)}px`);
		} else {
			el.style.removeProperty('--distill-margin-left');
			el.style.removeProperty('--distill-margin-right');
			el.style.removeProperty('--distill-effective-sidenote-width');
			el.style.removeProperty('--distill-effective-toc-width');
		}
	}

	/**
	 * Start observing for edit mode — toggles `.distill-narrow` on
	 * the `.markdown-source-view` element instead of preview view.
	 */
	observeEdit(leafContent: HTMLElement, sourceView: HTMLElement): void {
		// Already observing the same element and same sourceView — just re-check
		if (this.currentTarget === leafContent && this.currentSourceView === sourceView && this.observer) {
			this.checkEdit(leafContent, sourceView);
			return;
		}

		this.disconnect();
		this.currentTarget = leafContent;
		this.currentMode = 'edit';
		this.currentSourceView = sourceView;

		this.observer = new ResizeObserver(() => {
			this.checkEdit(leafContent, sourceView);
		});
		this.observer.observe(leafContent);

		this.checkEdit(leafContent, sourceView);
	}

	private checkEdit(el: HTMLElement, sourceView: HTMLElement): void {
		const leafWidth = el.getBoundingClientRect().width;
		const MIN_USABLE_MARGIN = 120;

		// Use the max-width constraint (readable line width) rather than actual
		// content width, since long lines overflow beyond the readable width.
		const cmContent = el.querySelector('.cm-content') as HTMLElement;
		let contentWidth = 0;
		if (cmContent) {
			const maxW = getComputedStyle(cmContent).maxWidth;
			contentWidth = maxW && maxW !== 'none' ? parseFloat(maxW) : cmContent.offsetWidth;
			// Clamp to actual leaf width
			if (contentWidth > leafWidth) contentWidth = leafWidth;
		}

		let isNarrow: boolean;
		if (contentWidth > 0) {
			const marginAvailable = (leafWidth - contentWidth) / 2;
			isNarrow = marginAvailable < MIN_USABLE_MARGIN;
		} else {
			isNarrow = leafWidth < this.settings.collapseWidth;
		}

		el.classList.toggle('distill-narrow', isNarrow);

		if (!isNarrow && contentWidth > 0) {
			const marginAvailable = Math.floor((leafWidth - contentWidth) / 2);
			const gutter = this.settings.gutterWidth;
			const effectiveWidth = Math.max(MIN_USABLE_MARGIN, marginAvailable - gutter);
			el.style.setProperty('--distill-margin-left', `${marginAvailable}px`);
			el.style.setProperty('--distill-margin-right', `${marginAvailable}px`);
			el.style.setProperty('--distill-effective-sidenote-width', `${effectiveWidth}px`);
			el.style.setProperty('--distill-effective-toc-width', `${Math.min(this.settings.tocWidth, effectiveWidth)}px`);
		} else {
			el.style.removeProperty('--distill-margin-left');
			el.style.removeProperty('--distill-margin-right');
			el.style.removeProperty('--distill-effective-sidenote-width');
			el.style.removeProperty('--distill-effective-toc-width');
		}
	}

	disconnect(): void {
		this.observer?.disconnect();
		this.observer = null;
		// Clean up classes and CSS vars from the current target to prevent
		// stale styles on leaves after tab switches.
		if (this.currentTarget) {
			this.currentTarget.classList.remove('distill-narrow');
			this.currentTarget.style.removeProperty('--distill-margin-left');
			this.currentTarget.style.removeProperty('--distill-margin-right');
			this.currentTarget.style.removeProperty('--distill-effective-sidenote-width');
			this.currentTarget.style.removeProperty('--distill-effective-toc-width');
		}
		this.currentTarget = null;
		this.currentSourceView = null;
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
		if (this.currentTarget) {
			this.currentTarget.classList.remove('distill-narrow');
			this.currentTarget.style.removeProperty('--distill-margin-left');
			this.currentTarget.style.removeProperty('--distill-margin-right');
			this.currentTarget.style.removeProperty('--distill-effective-sidenote-width');
			this.currentTarget.style.removeProperty('--distill-effective-toc-width');
		}
		this.currentTarget = null;
		this.currentSourceView = null;
	}
}
