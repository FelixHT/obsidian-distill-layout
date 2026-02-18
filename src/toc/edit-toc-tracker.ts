import type { HeadingEntry } from '../types';

/**
 * Scroll-based active heading tracker for edit mode.
 *
 * Unlike the preview-mode TocTracker that uses IntersectionObserver,
 * this listens to `.cm-scroller` scroll events and compares scrollTop
 * against heading pixel positions (from CM6 `lineBlockAt()`).
 * This avoids issues with CM6 virtualizing off-screen headings out
 * of the DOM.
 */
export class EditTocTracker {
	private activeId = '';
	private onActiveChange: (headingId: string) => void;
	private scrollHandler: (() => void) | null = null;
	private cmScroller: HTMLElement | null = null;
	private headings: HeadingEntry[] = [];

	constructor(onActiveChange: (headingId: string) => void) {
		this.onActiveChange = onActiveChange;
	}

	/**
	 * Start tracking headings against the CM scroller's scroll position.
	 */
	observe(headings: HeadingEntry[], cmScroller: HTMLElement): void {
		this.disconnect();

		if (headings.length === 0) return;

		this.headings = headings;
		this.cmScroller = cmScroller;

		this.scrollHandler = () => this.update();
		cmScroller.addEventListener('scroll', this.scrollHandler, { passive: true });

		// Set initial active heading
		this.update();
	}

	private update(): void {
		if (!this.cmScroller || this.headings.length === 0) return;

		const scrollTop = this.cmScroller.scrollTop;
		const viewportHeight = this.cmScroller.clientHeight;
		// Activation threshold: 20% into the viewport
		const threshold = scrollTop + viewportHeight * 0.2;

		// Find the last heading whose top is above the threshold
		let activeId = this.headings[0]!.id;
		for (const heading of this.headings) {
			if (heading.top <= threshold) {
				activeId = heading.id;
			} else {
				break;
			}
		}

		if (activeId !== this.activeId) {
			this.activeId = activeId;
			this.onActiveChange(activeId);
		}
	}

	disconnect(): void {
		if (this.scrollHandler && this.cmScroller) {
			this.cmScroller.removeEventListener('scroll', this.scrollHandler);
		}
		this.scrollHandler = null;
		this.cmScroller = null;
		this.headings = [];
		this.activeId = '';
	}

	destroy(): void {
		this.disconnect();
	}
}
