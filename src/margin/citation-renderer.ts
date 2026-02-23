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
	/** Track rendered citation IDs in memory — immune to Obsidian section virtualization. */
	private renderedIds = new Set<string>();

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
			if (this.renderedIds.has(cite.id)) continue;
			this.renderedIds.add(cite.id);

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
				this.appendWithEmphasis(citationEl, formatted);
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
	 * Append text to parent, wrapping \u201C...\u201D segments in <em> for title emphasis.
	 */
	private appendWithEmphasis(parent: HTMLElement, text: string): void {
		const parts = text.split(/(\u201C[^"\u201D]*\u201D)/);
		for (const part of parts) {
			if (part.startsWith('\u201C') && part.endsWith('\u201D')) {
				const em = document.createElement('em');
				em.textContent = part;
				parent.appendChild(em);
			} else if (part) {
				parent.appendChild(document.createTextNode(part));
			}
		}
	}

	clear(): void {
		for (const c of this.citations) c.remove();
		this.citations = [];
		this.citationIndex = 0;
		this.renderedIds.clear();
		this.registry.unregisterByType('citation');

		// Best-effort DOM cleanup (may miss virtualized sections)
		document.querySelectorAll('[data-distill-citation-rendered]').forEach(el => {
			el.removeAttribute('data-distill-citation-rendered');
		});
	}

	destroy(): void {
		this.clear();
	}
}
