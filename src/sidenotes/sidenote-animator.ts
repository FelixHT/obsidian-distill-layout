import type { DistillLayoutSettings } from '../types';

/**
 * Animated transitions for sidenotes and margin items.
 * Uses IntersectionObserver to trigger entrance animations
 * when items scroll into view.
 */
export class SidenoteAnimator {
	private observer: IntersectionObserver | null = null;
	private settings: DistillLayoutSettings;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	/**
	 * Observe margin items for entrance animations.
	 * @param container  The column container holding margin items.
	 */
	observe(container: HTMLElement): void {
		if (!this.settings.sidenoteAnimations) return;

		this.disconnect();

		const style = this.settings.sidenoteAnimationStyle;

		this.observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target as HTMLElement;
						el.classList.add('distill-sidenote-enter');
						// Unobserve after animation triggers
						this.observer?.unobserve(el);
					}
				}
			},
			{ threshold: 0.1 }
		);

		// Find all margin items in the container
		const items = container.querySelectorAll(
			'.distill-sidenote, .distill-margin-figure, .distill-margin-code, .distill-margin-comment, .distill-margin-citation, .distill-margin-dataview'
		);

		for (const item of Array.from(items)) {
			const el = item as HTMLElement;
			// Add initial animation class based on style
			el.classList.add('distill-sidenote-animate');
			if (style === 'slide') {
				el.classList.add('distill-sidenote-animate-slide');
			}
			this.observer.observe(el);
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
