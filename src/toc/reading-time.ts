/**
 * Estimated reading time — word count + time displayed above the TOC nav.
 */
export class ReadingTime {
	private el: HTMLElement | null = null;

	/**
	 * Render reading time into the TOC container.
	 * @param tocContainer  The column container where TOC lives.
	 * @param previewSizer  The preview sizer to extract text from.
	 * @param wordsPerMinute  Reading speed setting.
	 */
	render(tocContainer: HTMLElement, previewSizer: HTMLElement, wordsPerMinute: number): void {
		this.clear();

		const text = this.extractText(previewSizer);
		const wordCount = this.countWords(text);
		const minutes = Math.max(1, Math.ceil(wordCount / wordsPerMinute));

		this.el = document.createElement('div');
		this.el.className = 'distill-reading-time';
		this.el.textContent = `${minutes} min read \u00B7 ${wordCount.toLocaleString()} words`;

		const nav = tocContainer.querySelector('.distill-toc');
		(nav || tocContainer).prepend(this.el);
	}

	private extractText(previewSizer: HTMLElement): string {
		// Clone to avoid modifying the DOM
		const clone = previewSizer.cloneNode(true) as HTMLElement;

		// Remove elements we don't want to count
		const exclude = clone.querySelectorAll('.distill-toc, .distill-sidenote, pre code, .distill-left-column, .distill-right-column');
		for (const el of Array.from(exclude)) {
			el.remove();
		}

		return clone.textContent || '';
	}

	private countWords(text: string): number {
		const trimmed = text.trim();
		if (!trimmed) return 0;
		return trimmed.split(/\s+/).length;
	}

	clear(): void {
		this.el?.remove();
		this.el = null;
	}

	destroy(): void {
		this.clear();
	}
}
