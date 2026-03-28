/**
 * Estimated reading time — word count + time displayed above the TOC nav.
 */
export class ReadingTime {
	private el: HTMLElement | null = null;

	/**
	 * Render reading time into the TOC container.
	 * @param tocContainer  The column container where TOC lives.
	 * @param sourceText  The full source markdown text (immune to virtualization).
	 * @param wordsPerMinute  Reading speed setting.
	 */
	render(tocContainer: HTMLElement, sourceText: string, wordsPerMinute: number): void {
		this.clear();

		const text = this.stripMarkdown(sourceText);
		const wordCount = this.countWords(text);
		const minutes = Math.max(1, Math.ceil(wordCount / wordsPerMinute));

		this.el = document.createElement('div');
		this.el.className = 'distill-reading-time';
		this.el.textContent = `${minutes} min read \u00B7 ${wordCount.toLocaleString()} words`;

		const nav = tocContainer.querySelector('.distill-toc');
		(nav || tocContainer).appendChild(this.el);
	}

	private stripMarkdown(text: string): string {
		return text
			.replace(/^---[\s\S]*?---/m, '')       // frontmatter
			.replace(/```[\s\S]*?```/g, '')         // code blocks
			.replace(/`[^`]+`/g, '')                // inline code
			.replace(/!\[\[.*?\]\]/g, '')            // embeds
			.replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2') // wikilinks
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links
			.replace(/^#+\s/gm, '')                  // heading markers
			.replace(/\{\>.*?\}/g, '')               // custom sidenote syntax
			.replace(/\{\?.*?\}/g, '')               // comment syntax
			.replace(/\[\^[^\]]+\]:?\s?/g, '')       // footnote refs/defs
			.replace(/[*_~`>#\-|]/g, '');            // remaining markdown chars
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
