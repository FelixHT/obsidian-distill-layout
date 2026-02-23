import type { HeadingEntry } from '../types';

/**
 * Scroll-position-based active heading tracker for reading mode.
 *
 * Uses scrollTop comparison against heading positions (same pattern as
 * EditTocTracker) instead of IntersectionObserver.  This works for
 * both DOM-present and virtualized headings, since it only needs the
 * `top` value — no actual DOM element observation required.
 */
export class TocTracker {
	private activeId = '';
	private onActiveChange: (headingId: string) => void;
	private scrollHandler: (() => void) | null = null;
	private scrollContainer: HTMLElement | null = null;
	private headings: HeadingEntry[] = [];

	constructor(onActiveChange: (headingId: string) => void) {
		this.onActiveChange = onActiveChange;
	}

	/**
	 * Start tracking the given headings against the scroll container.
	 * @param scrollContainer  `.markdown-preview-view` (the scroll container).
	 */
	observe(headings: HeadingEntry[], scrollContainer: HTMLElement): void {
		this.disconnect();

		if (headings.length === 0) return;

		this.headings = headings;
		this.scrollContainer = scrollContainer;

		this.scrollHandler = () => this.update();
		scrollContainer.addEventListener('scroll', this.scrollHandler, { passive: true });

		// Set initial active heading
		this.update();
	}

	/**
	 * Update heading references and positions after sections render.
	 * Called from processSection() when newly rendered headings are linked.
	 */
	updateHeadings(headings: HeadingEntry[]): void {
		this.headings = headings;
	}

	private update(): void {
		if (!this.scrollContainer || this.headings.length === 0) return;

		const scrollTop = this.scrollContainer.scrollTop;
		const viewportHeight = this.scrollContainer.clientHeight;
		// Activation threshold: 20% into the viewport
		const threshold = scrollTop + viewportHeight * 0.2;

		// Recompute top for DOM-present headings to stay accurate
		const sizer = this.scrollContainer.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (sizer) {
			const sizerRect = sizer.getBoundingClientRect();
			for (const h of this.headings) {
				if (h.element !== sizer && h.element.isConnected) {
					h.top = h.element.getBoundingClientRect().top - sizerRect.top;
				}
			}
		}

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
		if (this.scrollHandler && this.scrollContainer) {
			this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
		}
		this.scrollHandler = null;
		this.scrollContainer = null;
		this.headings = [];
		this.activeId = '';
	}

	destroy(): void {
		this.disconnect();
	}
}
