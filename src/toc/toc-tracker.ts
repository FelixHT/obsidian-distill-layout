import type { HeadingEntry } from '../types';

/**
 * Uses IntersectionObserver to track which heading is currently
 * in the viewport's "active zone" (top ~20%).
 * Reports the active heading ID for highlight tracking.
 */
export class TocTracker {
	private observer: IntersectionObserver | null = null;
	private activeId: string = '';
	private onActiveChange: (headingId: string) => void;

	constructor(onActiveChange: (headingId: string) => void) {
		this.onActiveChange = onActiveChange;
	}

	/**
	 * Start tracking the given headings.
	 * @param scrollContainer The element that actually scrolls
	 *   (`.workspace-leaf-content[data-type="markdown"]`).
	 */
	observe(headings: HeadingEntry[], scrollContainer: HTMLElement): void {
		this.disconnect();

		if (headings.length === 0) return;

		// Trigger zone: top 10% to 80% → heading in upper portion activates
		this.observer = new IntersectionObserver(
			(entries) => {
				// Collect all currently-intersecting headings
				const visible: { id: string; top: number }[] = [];

				for (const entry of entries) {
					if (entry.isIntersecting) {
						const id = (entry.target as HTMLElement).dataset.distillHeadingId || '';
						visible.push({ id, top: entry.boundingClientRect.top });
					}
				}

				if (visible.length > 0) {
					// Pick the topmost intersecting heading
					visible.sort((a, b) => a.top - b.top);
					const topId = visible[0]!.id;
					if (topId && topId !== this.activeId) {
						this.activeId = topId;
						this.onActiveChange(topId);
					}
				}
				// When nothing intersects, keep last active (user is between headings)
			},
			{
				root: scrollContainer,
				rootMargin: '-10% 0px -80% 0px',
				threshold: 0,
			}
		);

		for (const heading of headings) {
			heading.element.dataset.distillHeadingId = heading.id;
			this.observer.observe(heading.element);
		}

		// Set initial active to first heading
		if (headings[0]) {
			this.activeId = headings[0].id;
			this.onActiveChange(this.activeId);
		}
	}

	disconnect(): void {
		this.observer?.disconnect();
		this.observer = null;
	}

	destroy(): void {
		this.disconnect();
	}
}
