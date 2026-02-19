import type { ParsedFootnote, DistillLayoutSettings } from '../types';
import { parseDefinitions } from './edit-footnote-parser';

/**
 * Parses footnote references and their content from the rendered Reading View DOM.
 * Handles Obsidian's various footnote HTML formats and timing issues.
 */
export class FootnoteParser {
	private settings: DistillLayoutSettings;
	private pendingObservers: Map<HTMLElement, MutationObserver> = new Map();

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	/** Disconnect any pending MutationObserver watchers (e.g. on full refresh). */
	cancelPending(): void {
		this.pendingObservers.forEach(obs => obs.disconnect());
		this.pendingObservers.clear();
	}

	/**
	 * Parse all footnote references in a section element.
	 * Returns parsed footnotes with content if the footnotes section exists,
	 * or calls onPending if content isn't available yet.
	 */
	parseSection(
		sectionEl: HTMLElement,
		previewView: HTMLElement,
		onParsed: (footnotes: ParsedFootnote[]) => void
	): void {
		const refs = this.findRefs(sectionEl);
		if (refs.length === 0) return;

		const footnotesSection = this.findFootnotesSection(previewView);

		if (footnotesSection) {
			const footnotes = this.resolveContent(refs, footnotesSection);
			if (footnotes.length > 0) onParsed(footnotes);
		} else {
			// Footnotes section hasn't rendered yet - observe for it
			this.observeForSection(previewView, refs, onParsed);
		}
	}

	/**
	 * Parse all footnotes from the full document (used on file-open).
	 * If the footnotes section isn't in the DOM yet and onLateResolved is
	 * provided, sets up a MutationObserver to resolve them when it appears.
	 */
	parseFullDocument(
		previewView: HTMLElement,
		onLateResolved?: (footnotes: ParsedFootnote[]) => void,
		sourceText?: string
	): ParsedFootnote[] {
		const refs = this.findRefs(previewView);
		if (refs.length === 0) return [];

		const footnotesSection = this.findFootnotesSection(previewView);
		if (footnotesSection) {
			return this.resolveContent(refs, footnotesSection);
		}

		// DOM section not available — try source text fallback
		if (sourceText) {
			const defs = parseDefinitions(sourceText);
			if (defs.size > 0) {
				const refOrder = this.extractRefOrder(sourceText);
				return this.resolveFromSource(refs, defs, refOrder);
			}
		}

		// Last resort: observe for late-arriving DOM section
		if (onLateResolved) {
			this.observeForSection(previewView, refs, onLateResolved);
		}
		return [];
	}

	/**
	 * Parse {>text} custom syntax. Idempotent: on re-render, recovers
	 * content stored on markers from a previous parse (Phase A), then
	 * processes any remaining raw {>text} text nodes (Phase B).
	 */
	parseCustomSyntax(el: HTMLElement): ParsedFootnote[] {
		if (!this.settings.customSidenoteSyntax) return [];

		const results: ParsedFootnote[] = [];

		// ── Phase A: recover existing markers from a previous parse ──
		const existingMarkers = el.querySelectorAll(
			'span.distill-sidenote-marker[data-sidenote-content]'
		);
		for (const marker of Array.from(existingMarkers)) {
			const htmlMarker = marker as HTMLElement;
			const content = htmlMarker.dataset.sidenoteContent;
			const id = htmlMarker.dataset.footnoteId;
			const icon = htmlMarker.dataset.sidenoteIcon;
			if (content && id) {
				results.push({ id, refElement: htmlMarker, content, type: 'marginnote', icon: icon || undefined });
			}
		}

		// ── Phase B: walk text nodes for new {>text} patterns (with optional !icon: prefix) ──
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
		const regex = /\{>(?!fig:)(?:!(\w+):\s*)?(?:([^:|]+)\|)?([^}]+)\}/g;

		const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

		let node;
		while ((node = walker.nextNode())) {
			const text = node.textContent || '';
			const matches: RegExpMatchArray[] = [];
			let match;
			regex.lastIndex = 0;
			while ((match = regex.exec(text)) !== null) {
				matches.push([...match] as RegExpMatchArray);
			}
			if (matches.length > 0) {
				nodesToProcess.push({ node: node as Text, matches });
			}
		}

		const idCounts = new Map<string, number>();

		for (const { node, matches } of nodesToProcess.reverse()) {
			const parent = node.parentElement;
			if (!parent) continue;
			let currentText = node.textContent || '';

			for (const match of matches.reverse()) {
				const fullMatch = match[0]!;
				const icon = match[1]?.trim() || '';   // capture group 1: icon name
				const content = match[3]!.trim();      // capture group 3: content (was group 2)
				const index = currentText.lastIndexOf(fullMatch);
				if (index === -1) continue;

				// Deterministic ID from content hash (stable across re-renders)
				const baseId = `custom-${this.hashContent(content)}`;
				const count = idCounts.get(baseId) || 0;
				idCounts.set(baseId, count + 1);
				const id = count > 0 ? `${baseId}-${count}` : baseId;

				const marker = document.createElement('span');
				marker.className = 'distill-sidenote-marker';
				marker.dataset.sidenoteContent = content;
				marker.dataset.footnoteId = id;
				marker.dataset.sidenoteId = id;
				if (icon) {
					marker.dataset.sidenoteIcon = icon;
				}

				const before = currentText.slice(0, index);
				const after = currentText.slice(index + fullMatch.length);
				node.textContent = before;

				if (after) {
					parent.insertBefore(document.createTextNode(after), node.nextSibling);
				}
				parent.insertBefore(marker, node.nextSibling);

				results.push({
					id,
					refElement: marker,
					content,
					type: 'marginnote',
					icon: icon || undefined,
				});

				currentText = before;
			}
		}

		return results;
	}

	/**
	 * djb2-style hash → stable 8-char base36 string for deterministic IDs.
	 */
	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
		}
		return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
	}

	private findRefs(container: HTMLElement): Array<{ el: HTMLElement; id: string }> {
		const selectors = [
			'sup.footnote-ref a',
			'a[href^="#fn"]',
			'a[href^="#user-content-fn"]',
			'sup[data-footnote-id]',
			'a[data-footnote-ref]',
		];

		const seen = new Set<Element>();
		const refs: Array<{ el: HTMLElement; id: string }> = [];

		for (const selector of selectors) {
			const elements = Array.from(container.querySelectorAll(selector));
			for (const el of elements) {
				const refEl = (el.closest('sup') || el) as HTMLElement;
				if (seen.has(refEl)) continue;
				seen.add(refEl);

				// Skip back-references inside the footnotes definition section
				if (refEl.closest('section.footnotes, .footnotes, div.footnotes')) continue;

				const id = this.extractId(el);
				if (id) refs.push({ el: refEl, id });
			}
		}

		// Sort by DOM position so numbering follows document order
		refs.sort((a, b) => {
			const pos = a.el.compareDocumentPosition(b.el);
			if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
			if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			return 0;
		});

		return refs;
	}

	private extractId(el: Element): string | null {
		// Try data attribute first
		const dataId = el.getAttribute('data-footnote-id');
		if (dataId) {
			const match = dataId.match(/(?:fnref-)?(.+?)(?:-[a-f0-9]{4,})?$/);
			return match?.[1] ?? null;
		}

		// Try href
		const href = el.getAttribute('href') || '';
		const hrefMatch = href.match(/#(?:user-content-)?fn(?:ref)?[-_]?(.+?)(?:-[a-f0-9]{4,})?$/i);
		return hrefMatch?.[1] ?? null;
	}

	private findFootnotesSection(previewView: HTMLElement): HTMLElement | null {
		for (const sel of ['section.footnotes', '.footnotes', 'div.footnotes']) {
			const section = previewView.querySelector(sel);
			if (section) return section as HTMLElement;
		}
		return null;
	}

	private resolveContent(
		refs: Array<{ el: HTMLElement; id: string }>,
		footnotesSection: HTMLElement
	): ParsedFootnote[] {
		const results: ParsedFootnote[] = [];

		for (const { el, id } of refs) {
			const itemSelectors = [
				`li[id^="fn-${id}-"]`,
				`li[id^="fn${id}-"]`,
				`li[id$="-${id}"]`,
				`li[id="fn-${id}"]`,
				`li[id="fn${id}"]`,
				`li[id="user-content-fn-${id}"]`,
			];

			let contentEl: Element | null = null;
			for (const sel of itemSelectors) {
				contentEl = footnotesSection.querySelector(sel);
				if (contentEl) break;
			}

			if (contentEl) {
				const clone = contentEl.cloneNode(true) as HTMLElement;
				// Remove back-reference links
				clone.querySelectorAll('a.footnote-backref, a[href^="#fnref"], a[class*="backref"]')
					.forEach(backref => backref.remove());
				const content = clone.textContent?.trim() || '';

				if (content) {
					results.push({ id, refElement: el, content, contentEl: clone, type: 'sidenote' });
				}
			}
		}

		return results;
	}

	private resolveFromSource(
		refs: Array<{ el: HTMLElement; id: string }>,
		definitions: Map<string, string>,
		refOrder: string[]
	): ParsedFootnote[] {
		// Build sequential-number → original-ID mapping.
		// Obsidian renumbers all footnotes sequentially (1, 2, 3, ...)
		// by order of first reference, regardless of original ID.
		const numToId = new Map<string, string>();
		for (let i = 0; i < refOrder.length; i++) {
			numToId.set(String(i + 1), refOrder[i]!);
		}

		const results: ParsedFootnote[] = [];
		for (const { el, id } of refs) {
			// Try direct match first (works for numeric IDs like "1", "2")
			let content = definitions.get(id);
			// If no direct match, map sequential number to original ID
			if (!content) {
				const originalId = numToId.get(id);
				if (originalId) content = definitions.get(originalId);
			}
			if (content) {
				results.push({ id, refElement: el, content, type: 'sidenote' });
			}
		}
		return results;
	}

	/**
	 * Extract unique footnote reference IDs from source text in document order.
	 * This gives us the sequential numbering Obsidian uses in the rendered DOM.
	 */
	private extractRefOrder(sourceText: string): string[] {
		const seen = new Set<string>();
		const order: string[] = [];
		const regex = /\[\^([^\]]+)\](?!:)/g;
		let match;
		while ((match = regex.exec(sourceText)) !== null) {
			const id = match[1]!;
			// Skip refs inside definition lines (e.g. [^id]: content)
			const lineStart = sourceText.lastIndexOf('\n', match.index - 1) + 1;
			const lineText = sourceText.slice(lineStart, sourceText.indexOf('\n', match.index));
			if (/^\[\^[^\]]+\]:/.test(lineText)) continue;
			if (!seen.has(id)) {
				seen.add(id);
				order.push(id);
			}
		}
		return order;
	}

	private observeForSection(
		previewView: HTMLElement,
		refs: Array<{ el: HTMLElement; id: string }>,
		onParsed: (footnotes: ParsedFootnote[]) => void
	): void {
		if (this.pendingObservers.has(previewView)) return;

		const observer = new MutationObserver((_mutations, obs) => {
			const section = this.findFootnotesSection(previewView);
			if (section) {
				obs.disconnect();
				this.pendingObservers.delete(previewView);
				const footnotes = this.resolveContent(refs, section);
				if (footnotes.length > 0) onParsed(footnotes);
			}
		});

		observer.observe(previewView, { childList: true, subtree: true });
		this.pendingObservers.set(previewView, observer);
	}

	destroy(): void {
		this.pendingObservers.forEach(obs => obs.disconnect());
		this.pendingObservers.clear();
	}
}
