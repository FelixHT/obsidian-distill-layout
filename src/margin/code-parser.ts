export interface ParsedMarginCode {
	id: string;
	refElement: HTMLElement;
	codeElement: HTMLElement;
	language: string;
}

/**
 * Detects code blocks with `language-margin-*` class and extracts them
 * for rendering in the margin column. The original code block is hidden.
 */
export class CodeParser {
	parse(container: HTMLElement): ParsedMarginCode[] {
		const results: ParsedMarginCode[] = [];

		const preElements = container.querySelectorAll('pre');
		for (const pre of Array.from(preElements)) {
			// Skip already-processed
			if ((pre as HTMLElement).dataset.distillMarginCode) continue;

			const code = pre.querySelector('code');
			if (!code) continue;

			// Look for language-margin-* class
			const classes = Array.from(code.classList);
			const marginClass = classes.find(c => c.startsWith('language-margin-'));
			if (!marginClass) continue;

			// Extract actual language (strip 'language-margin-' prefix)
			const language = marginClass.replace('language-margin-', '');
			const id = `margin-code-${this.hashContent(code.textContent || '')}`;

			// Clone the highlighted code element
			const clonedPre = pre.cloneNode(true) as HTMLElement;

			// Hide the original in content
			(pre as HTMLElement).classList.add('distill-hidden');
			(pre as HTMLElement).dataset.distillMarginCode = 'true';

			results.push({
				id,
				refElement: pre as HTMLElement,
				codeElement: clonedPre,
				language,
			});
		}

		return results;
	}

	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
		}
		return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
	}
}
