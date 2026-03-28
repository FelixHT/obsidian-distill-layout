/**
 * TOC section preview tooltips — hover a TOC item to see the first
 * ~N characters of that section in a tooltip.
 */
export class TocTooltip {
	private tooltipEl: HTMLElement | null = null;
	private hideTimer: ReturnType<typeof setTimeout> | null = null;
	private cleanup: Array<() => void> = [];

	/**
	 * Attach hover handlers to TOC items.
	 * @param tocContainer  The container holding `.distill-toc` nav.
	 * @param previewSizer  The preview sizer to extract section text from.
	 * @param maxChars  Maximum characters to show in preview.
	 */
	attach(tocContainer: HTMLElement, previewSizer: HTMLElement, maxChars: number): void {
		this.detach();

		// Create shared tooltip element
		this.tooltipEl = document.createElement('div');
		this.tooltipEl.className = 'distill-toc-tooltip';
		document.body.appendChild(this.tooltipEl);

		const links = tocContainer.querySelectorAll('.distill-toc-link');
		for (const link of Array.from(links)) {
			const headingId = (link as HTMLElement).dataset.headingId;
			if (!headingId) continue;

			const enter = (e: Event) => {
				if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
				const heading = previewSizer.querySelector(`[data-distill-heading-id="${headingId}"]`) as HTMLElement;
				if (!heading || !this.tooltipEl) return;

				const preview = this.extractSectionPreview(heading, maxChars);
				if (!preview) return;

				this.tooltipEl.textContent = preview;
				// Make visible first so we can measure its dimensions
				this.tooltipEl.classList.add('distill-toc-tooltip-visible');

				const rect = (link as HTMLElement).getBoundingClientRect();
				const tipRect = this.tooltipEl.getBoundingClientRect();

				// Try right side first, fall back to left if it overflows
				let left = rect.right + 8;
				if (left + tipRect.width > window.innerWidth) {
					left = rect.left - tipRect.width - 8;
				}
				left = Math.max(0, left);

				// Clamp vertical position to viewport
				const top = Math.min(rect.top, window.innerHeight - tipRect.height - 8);

				this.tooltipEl.style.top = `${Math.max(0, top)}px`;
				this.tooltipEl.style.left = `${left}px`;
			};

			const leave = () => {
				this.hideTimer = setTimeout(() => {
					this.tooltipEl?.classList.remove('distill-toc-tooltip-visible');
				}, 200);
			};

			link.addEventListener('mouseenter', enter);
			link.addEventListener('mouseleave', leave);
			this.cleanup.push(() => {
				link.removeEventListener('mouseenter', enter);
				link.removeEventListener('mouseleave', leave);
			});
		}
	}

	private extractSectionPreview(heading: HTMLElement, maxChars: number): string {
		// In Obsidian reading view, each heading and its content are in separate
		// .markdown-preview-section divs. Find the heading's parent section,
		// then walk subsequent sibling sections for text content.
		let text = '';
		const parentSection = heading.closest('.markdown-preview-section');
		if (!parentSection) {
			// Fallback: walk siblings of heading directly
			let sibling = heading.nextElementSibling;
			while (sibling && text.length < maxChars) {
				if (/^H[1-6]$/i.test(sibling.tagName)) break;
				const nodeText = sibling.textContent?.trim();
				if (nodeText) text += (text ? ' ' : '') + nodeText;
				sibling = sibling.nextElementSibling;
			}
		} else {
			let section = parentSection.nextElementSibling;
			while (section && text.length < maxChars) {
				// Stop if this section contains a heading
				const sectionHeading = section.querySelector('h1, h2, h3, h4, h5, h6');
				if (sectionHeading) break;
				// Skip distill elements
				if (section.classList.contains('distill-left-column') ||
					section.classList.contains('distill-right-column')) {
					section = section.nextElementSibling;
					continue;
				}
				const nodeText = section.textContent?.trim();
				if (nodeText) text += (text ? ' ' : '') + nodeText;
				section = section.nextElementSibling;
			}
		}

		if (!text) return '';
		if (text.length > maxChars) {
			return text.slice(0, maxChars).replace(/\s+\S*$/, '') + '\u2026';
		}
		return text;
	}

	detach(): void {
		for (const fn of this.cleanup) fn();
		this.cleanup = [];
		if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
		this.tooltipEl?.remove();
		this.tooltipEl = null;
	}

	destroy(): void {
		this.detach();
	}
}
