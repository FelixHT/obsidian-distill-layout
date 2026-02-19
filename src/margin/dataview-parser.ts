export interface ParsedDataview {
	id: string;
	refElement: HTMLElement;
	renderedContent: HTMLElement | null;
}

/**
 * Detects `dataview-margin` code blocks and captures their rendered output.
 * Uses MutationObserver to wait for Dataview's async rendering (with timeout).
 */
export class DataviewParser {
	private observers: MutationObserver[] = [];

	parse(container: HTMLElement, onReady?: (parsed: ParsedDataview) => void): ParsedDataview[] {
		const results: ParsedDataview[] = [];

		const preElements = container.querySelectorAll('pre');
		for (const pre of Array.from(preElements)) {
			if ((pre as HTMLElement).dataset.distillDataviewMargin) continue;

			const code = pre.querySelector('code');
			if (!code) continue;

			const classes = Array.from(code.classList);
			if (!classes.includes('language-dataview-margin')) continue;

			const id = `dataview-${this.hashContent(code.textContent || '')}`;
			(pre as HTMLElement).dataset.distillDataviewMargin = 'true';

			// Look for Dataview-rendered content (sibling or replacement)
			const rendered = this.findRenderedContent(pre as HTMLElement);

			if (rendered) {
				(pre as HTMLElement).style.display = 'none';
				results.push({
					id,
					refElement: pre as HTMLElement,
					renderedContent: rendered.cloneNode(true) as HTMLElement,
				});
			} else if (onReady) {
				// Wait for Dataview to render
				this.observeForRender(pre as HTMLElement, id, onReady);
			}
		}

		return results;
	}

	private findRenderedContent(pre: HTMLElement): HTMLElement | null {
		// Dataview typically replaces the code block with a rendered container
		const next = pre.nextElementSibling as HTMLElement;
		if (next?.classList.contains('dataview')) {
			return next;
		}

		// Or renders inside a wrapper
		const parent = pre.parentElement;
		if (parent) {
			const dv = parent.querySelector('.dataview, .block-language-dataview');
			if (dv && dv !== pre) return dv as HTMLElement;
		}

		return null;
	}

	private observeForRender(pre: HTMLElement, id: string, onReady: (parsed: ParsedDataview) => void): void {
		const parent = pre.parentElement;
		if (!parent) return;

		const observer = new MutationObserver((_mutations, obs) => {
			const rendered = this.findRenderedContent(pre);
			if (rendered) {
				obs.disconnect();
				pre.style.display = 'none';
				onReady({
					id,
					refElement: pre,
					renderedContent: rendered.cloneNode(true) as HTMLElement,
				});
			}
		});

		observer.observe(parent, { childList: true, subtree: true });
		this.observers.push(observer);

		// Timeout after 5 seconds
		setTimeout(() => {
			observer.disconnect();
		}, 5000);
	}

	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
		}
		return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
	}

	destroy(): void {
		for (const obs of this.observers) obs.disconnect();
		this.observers = [];
	}
}
