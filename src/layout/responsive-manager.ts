import type { DistillLayoutSettings } from '../types';

/**
 * Monitors the leaf container width and toggles narrow mode
 * when the pane is below the collapse threshold.
 */
export class ResponsiveManager {
	private settings: DistillLayoutSettings;
	private observer: ResizeObserver | null = null;
	private currentTarget: HTMLElement | null = null;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
		// Re-check with new threshold
		if (this.currentTarget) {
			this.check(this.currentTarget);
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

		this.observer = new ResizeObserver(() => {
			this.check(leafContent);
		});
		this.observer.observe(leafContent);

		// Initial check
		this.check(leafContent);
	}

	private check(el: HTMLElement): void {
		const width = el.getBoundingClientRect().width;
		const previewView = el.querySelector('.markdown-preview-view');
		if (!previewView) return;

		const isNarrow = width < this.settings.collapseWidth;
		previewView.classList.toggle('distill-narrow', isNarrow);
	}

	/**
	 * Start observing for edit mode — toggles `.distill-narrow` on
	 * the `.markdown-source-view` element instead of preview view.
	 */
	observeEdit(leafContent: HTMLElement, sourceView: HTMLElement): void {
		// Already observing the same element — just re-check
		if (this.currentTarget === leafContent && this.observer) {
			this.checkEdit(leafContent, sourceView);
			return;
		}

		this.disconnect();
		this.currentTarget = leafContent;

		this.observer = new ResizeObserver(() => {
			this.checkEdit(leafContent, sourceView);
		});
		this.observer.observe(leafContent);

		this.checkEdit(leafContent, sourceView);
	}

	private checkEdit(el: HTMLElement, sourceView: HTMLElement): void {
		const width = el.getBoundingClientRect().width;
		const isNarrow = width < this.settings.collapseWidth;
		sourceView.classList.toggle('distill-narrow', isNarrow);
	}

	disconnect(): void {
		this.observer?.disconnect();
		this.observer = null;
		// Keep distill-narrow class during refresh cycles to prevent flicker
		this.currentTarget = null;
	}

	destroy(): void {
		this.observer?.disconnect();
		this.observer = null;
		// Only remove distill-narrow on plugin unload
		if (this.currentTarget) {
			const pv = this.currentTarget.querySelector('.markdown-preview-view');
			pv?.classList.remove('distill-narrow');
			const sv = this.currentTarget.querySelector('.markdown-source-view');
			sv?.classList.remove('distill-narrow');
		}
		this.currentTarget = null;
	}
}
