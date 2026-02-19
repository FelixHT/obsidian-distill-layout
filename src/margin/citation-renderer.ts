import type { DistillLayoutSettings } from '../types';
import type { MarginItemRegistry } from './margin-item-registry';
import type { ParsedCitation } from './citation-parser';
import { CitationParser } from './citation-parser';

/**
 * Renders margin citations from parsed [@citekey] syntax.
 */
export class CitationRenderer {
	private settings: DistillLayoutSettings;
	private registry: MarginItemRegistry;
	private parser: CitationParser;
	private citations: HTMLElement[] = [];
	private citationIndex = 0;

	constructor(settings: DistillLayoutSettings, registry: MarginItemRegistry, parser: CitationParser) {
		this.settings = settings;
		this.registry = registry;
		this.parser = parser;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	render(
		container: HTMLElement,
		citations: ParsedCitation[],
		sizerEl: HTMLElement,
		column: 'left' | 'right' = 'right'
	): void {
		const sizerRect = sizerEl.getBoundingClientRect();

		for (const cite of citations) {
			if (cite.refElement.dataset.distillCitationRendered) continue;
			cite.refElement.dataset.distillCitationRendered = 'true';

			this.citationIndex++;

			const citationEl = document.createElement('div');
			citationEl.className = 'distill-margin-citation';
			citationEl.dataset.citationId = cite.id;

			if (cite.bibEntry) {
				const formatted = this.parser.formatCitation(
					cite.bibEntry,
					this.settings.citationStyle,
					this.citationIndex
				);
				// Parse basic formatting (italicize title)
				citationEl.innerHTML = this.formatWithEmphasis(formatted);
			} else {
				citationEl.textContent = cite.page
					? `${cite.citekey}, ${cite.page}`
					: cite.citekey;
				citationEl.classList.add('distill-citation-unresolved');
			}

			// Position
			const refRect = cite.refElement.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			citationEl.style.top = refTop;
			citationEl.dataset.refTop = refTop;

			container.appendChild(citationEl);
			this.citations.push(citationEl);

			// Register with registry
			this.registry.register({
				element: citationEl,
				refElement: cite.refElement,
				type: 'citation',
				id: cite.id,
				column,
			});
		}
	}

	/**
	 * Convert text between \u201C...\u201D to <em> for title emphasis.
	 */
	private formatWithEmphasis(text: string): string {
		// Escape HTML first
		const escaped = text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
		// Italicize quoted titles
		return escaped.replace(/\u201C([^"\u201D]*)\u201D/g, '<em>\u201C$1\u201D</em>');
	}

	clear(): void {
		for (const c of this.citations) c.remove();
		this.citations = [];
		this.citationIndex = 0;
		this.registry.unregisterByType('citation');

		document.querySelectorAll('[data-distill-citation-rendered]').forEach(el => {
			el.removeAttribute('data-distill-citation-rendered');
		});
	}

	destroy(): void {
		this.clear();
	}
}
