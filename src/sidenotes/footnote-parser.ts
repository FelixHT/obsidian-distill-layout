import type { ParsedFootnote, DistillLayoutSettings } from '../types';
import { parseDefinitions } from './edit-footnote-parser';
import { App, MarkdownRenderer, Component } from 'obsidian';

/**
 * Parses footnote references and their content from the rendered Reading View DOM.
 * Handles Obsidian's various footnote HTML formats and timing issues.
 */
export class FootnoteParser {
	private settings: DistillLayoutSettings;
	private app: App;
	private pendingObservers: Map<HTMLElement, MutationObserver> = new Map();
	private renderComponents: Component[] = [];

	constructor(settings: DistillLayoutSettings, app: App) {
		this.settings = settings;
		this.app = app;
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
		onParsed: (footnotes: ParsedFootnote[]) => void,
		sourceText?: string
	): void {
		const refs = this.findRefs(sectionEl);
		if (refs.length === 0) return;

		const footnotesSection = this.findFootnotesSection(previewView);

		if (footnotesSection) {
			const footnotes = this.resolveContent(refs, footnotesSection);
			if (footnotes.length > 0) {
				onParsed(footnotes);
				return;
			}
			// DOM resolution found the section but failed to match IDs —
			// fall through to source text fallback instead of silently dropping.
		}

		if (sourceText) {
			// Footnotes section is virtualized or DOM IDs didn't match — fall back to source text
			const defs = parseDefinitions(sourceText);
			if (defs.size > 0) {
				const refOrder = this.extractRefOrder(sourceText);
				const footnotes = this.resolveFromSource(refs, defs, refOrder);
				if (footnotes.length > 0) onParsed(footnotes);
			}
		} else if (!footnotesSection) {
			// Footnotes section hasn't rendered yet and no source text - observe for it
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
			const resolved = this.resolveContent(refs, footnotesSection);
			if (resolved.length > 0) return resolved;
			// DOM resolution found the section but failed to match IDs —
			// fall through to source text fallback instead of returning empty.
		}

		// DOM section not available or IDs didn't match — try source text fallback
		if (sourceText) {
			const defs = parseDefinitions(sourceText);
			if (defs.size > 0) {
				const refOrder = this.extractRefOrder(sourceText);
				const resolved = this.resolveFromSource(refs, defs, refOrder);
				if (resolved.length > 0) return resolved;
			}
		}

		// Last resort: observe for late-arriving DOM section
		if (onLateResolved && !footnotesSection) {
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
		const existingMarkers = el.querySelectorAll<HTMLElement>(
			'span.distill-sidenote-marker[data-sidenote-content]'
		);
		for (const marker of Array.from(existingMarkers)) {
			const content = marker.dataset.sidenoteContent;
			const id = marker.dataset.footnoteId;
			const icon = marker.dataset.sidenoteIcon;
			if (content && id) {
				results.push({ id, refElement: marker, content, type: 'marginnote', icon: icon || undefined });
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
				const fullMatch = match[0];
				const icon = match[1]?.trim() || '';   // capture group 1: icon name
				const customId = match[2]?.trim();     // capture group 2: optional pipe-style ID
				const content = match[3]!.trim();      // capture group 3: content (was group 2)
				const index = currentText.lastIndexOf(fullMatch);
				if (index === -1) continue;

				// Use explicit pipe-style ID if provided, otherwise hash the content
				const baseId = customId ? `custom-${customId}` : `custom-${this.hashContent(content)}`;
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

		// ── Phase C: Cross-element matching (e.g., {>!icon: text with `code` more text}) ──
		// When Obsidian renders backticks as <code> elements, the {>...} pattern
		// spans multiple DOM nodes. Phase B only matches within single text nodes.
		// Here we check block elements' textContent for unhandled patterns.
		const blocks = el.querySelectorAll<HTMLElement>('p, li, td, th, dt, dd');
		const blockList: HTMLElement[] = Array.from(blocks);
		// Also check el itself if it's a block
		if (['P', 'LI', 'TD', 'TH', 'DT', 'DD', 'DIV'].includes(el.tagName)) {
			blockList.push(el);
		}

		for (const block of blockList) {
			const fullText = block.textContent || '';
			regex.lastIndex = 0;
			let crossMatch;
			while ((crossMatch = regex.exec(fullText)) !== null) {
				const matchText = crossMatch[0];
				const icon = crossMatch[1]?.trim() || '';
				const customId = crossMatch[2]?.trim();
				const content = crossMatch[3]?.trim() || '';
				if (!content) continue;

				// Skip if already handled by Phase A or B (marker with this content exists)
				const alreadyHandled = Array.from(block.querySelectorAll<HTMLElement>('span.distill-sidenote-marker'))
					.some(m => m.dataset.sidenoteContent === content);
				if (alreadyHandled) continue;

				// Find the DOM range: text node with "{>" prefix and text node with "}" suffix
				const range = this.findCrossElementRange(block, matchText);
				if (!range) continue;

				const baseId = customId ? `custom-${customId}` : `custom-${this.hashContent(content)}`;
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

				range.deleteContents();
				range.insertNode(marker);

				results.push({
					id,
					refElement: marker,
					content,
					type: 'marginnote',
					icon: icon || undefined,
				});

				// Reset regex after DOM mutation
				break;
			}
		}

		return results;
	}

	/**
	 * Find a DOM Range covering a {>...} match that spans multiple nodes.
	 * Walks text nodes within the block, building a concatenated string,
	 * and maps the match boundaries back to specific text node offsets.
	 */
	private findCrossElementRange(block: HTMLElement, matchText: string): Range | null {
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
		const nodes: { node: Text; start: number; end: number }[] = [];
		let offset = 0;
		let n;
		while ((n = walker.nextNode())) {
			const len = (n.textContent || '').length;
			nodes.push({ node: n as Text, start: offset, end: offset + len });
			offset += len;
		}

		const fullText = nodes.map(n => n.node.textContent || '').join('');
		const matchStart = fullText.indexOf(matchText);
		if (matchStart === -1) return null;
		const matchEnd = matchStart + matchText.length;

		// Find start node + offset
		let startNode: Text | null = null;
		let startOffset = 0;
		let endNode: Text | null = null;
		let endOffset = 0;

		for (const { node, start, end } of nodes) {
			if (startNode === null && matchStart >= start && matchStart < end) {
				startNode = node;
				startOffset = matchStart - start;
			}
			if (matchEnd > start && matchEnd <= end) {
				endNode = node;
				endOffset = matchEnd - start;
			}
		}

		if (!startNode || !endNode) return null;

		const range = document.createRange();
		range.setStart(startNode, startOffset);
		range.setEnd(endNode, endOffset);
		return range;
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
				// Render markdown to HTML so bold/italic/links display correctly
				const wrapper = document.createElement('div');
				const comp = new Component();
				comp.load();
				this.renderComponents.push(comp);
				void MarkdownRenderer.render(this.app, content, wrapper, '', comp);
				results.push({ id, refElement: el, content, contentEl: wrapper, type: 'sidenote' });
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
		for (const comp of this.renderComponents) comp.unload();
		this.renderComponents = [];
	}
}
