import type { HeadingEntry, DistillLayoutSettings } from '../types';

/**
 * Renders the TOC navigation inside the left column container.
 * Uses sticky positioning so it follows the viewport while scrolling.
 */
export class TocRenderer {
	private nav: HTMLElement | null = null;
	private items: Map<string, HTMLElement> = new Map();
	private settings: DistillLayoutSettings;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	/**
	 * Render the TOC into the given container element (left column).
	 * @param onItemClick  Optional callback for custom scroll behavior (edit mode).
	 *                     If provided, it's called instead of the default scrollIntoView.
	 */
	render(
		container: HTMLElement,
		headings: HeadingEntry[],
		onItemClick?: (heading: HeadingEntry) => void
	): void {
		this.clear();

		if (headings.length === 0) return;

		const nav = document.createElement('nav');
		nav.className = 'distill-toc';

		const ul = document.createElement('ul');
		ul.className = 'distill-toc-list';

		for (const heading of headings) {
			const li = this.createTocItem(heading, onItemClick);
			ul.appendChild(li);
		}

		nav.appendChild(ul);
		container.appendChild(nav);
		this.nav = nav;
	}

	/** Create a single TOC list item with a link. */
	private createTocItem(
		heading: HeadingEntry,
		onItemClick?: (heading: HeadingEntry) => void
	): HTMLElement {
		const li = document.createElement('li');
		li.className = `distill-toc-item distill-toc-h${heading.level}`;

		const a = document.createElement('a');
		a.className = 'distill-toc-link';
		a.textContent = heading.text;
		a.href = '#';
		a.dataset.headingId = heading.id;

		a.addEventListener('click', (e) => {
			e.preventDefault();
			if (onItemClick) {
				onItemClick(heading);
			} else {
				heading.element.scrollIntoView({
					behavior: this.settings.smoothScroll ? 'smooth' : 'auto',
					block: 'start',
				});
			}
		});

		li.appendChild(a);
		this.items.set(heading.id, li);
		return li;
	}

	/**
	 * Highlight the active heading in the TOC.
	 */
	setActive(headingId: string): void {
		this.items.forEach((li, id) => {
			li.classList.toggle('distill-toc-active', id === headingId);
		});
	}

	clear(): void {
		this.nav?.remove();
		this.nav = null;
		this.items.clear();
	}

	destroy(): void {
		this.clear();
	}
}
