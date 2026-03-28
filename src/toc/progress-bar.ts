/**
 * Reading progress bar — thin horizontal bar above the TOC showing scroll progress.
 */
export class ProgressBar {
	private barEl: HTMLElement | null = null;
	private fillEl: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private scrollContainer: HTMLElement | null = null;

	/**
	 * Render the progress bar into the TOC container.
	 * @param tocContainer  The column container where TOC lives.
	 * @param scrollContainer  The element that scrolls (leaf content).
	 */
	render(tocContainer: HTMLElement, scrollContainer: HTMLElement): void {
		this.clear();

		this.barEl = document.createElement('div');
		this.barEl.className = 'distill-progress-bar';

		this.fillEl = document.createElement('div');
		this.fillEl.className = 'distill-progress-fill';

		this.barEl.appendChild(this.fillEl);
		const nav = tocContainer.querySelector('.distill-toc');
		(nav || tocContainer).prepend(this.barEl);

		this.scrollContainer = scrollContainer;
		this.scrollHandler = () => this.updateProgress();
		scrollContainer.addEventListener('scroll', this.scrollHandler, { passive: true });

		// Initial update
		this.updateProgress();
	}

	private updateProgress(): void {
		if (!this.fillEl || !this.scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = this.scrollContainer;
		const maxScroll = scrollHeight - clientHeight;
		const progress = maxScroll > 0 ? Math.min(scrollTop / maxScroll, 1) : 1;
		this.fillEl.style.transform = `scaleX(${progress})`;
	}

	clear(): void {
		if (this.scrollHandler && this.scrollContainer) {
			this.scrollContainer.removeEventListener('scroll', this.scrollHandler);
		}
		this.barEl?.remove();
		this.barEl = null;
		this.fillEl = null;
		this.scrollHandler = null;
		this.scrollContainer = null;
	}

	destroy(): void {
		this.clear();
	}
}
