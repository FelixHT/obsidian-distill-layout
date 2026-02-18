import type { ParsedFootnote, DistillLayoutSettings } from '../types';
import { resolveCollisions } from './collision-resolver';

/**
 * Creates sidenote elements in the right column, positioned to align
 * with their footnote references. Also creates hidden inline fallbacks
 * for narrow mode.
 */
export class SidenoteRenderer {
	private settings: DistillLayoutSettings;
	private sidenotes: HTMLElement[] = [];
	/** For alternating mode: track which side each sidenote is on. */
	private leftSidenotes: HTMLElement[] = [];
	private rightSidenotes: HTMLElement[] = [];
	private inlineNotes: HTMLElement[] = [];
	private hiddenFootnoteSections: HTMLElement[] = [];
	private refMap = new Map<HTMLElement, HTMLElement>();
	/** Cleanup functions for event listeners added to elements we don't own (refs). */
	private eventCleanup: Array<() => void> = [];
	/** Active hover preview timers for cleanup. */
	private hoverTimers: Array<ReturnType<typeof setTimeout>> = [];
	/** Running index for alternating mode — persists across incremental render() calls. */
	private alternatingIndex = 0;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	/**
	 * Render sidenotes into column container(s).
	 * @param container      The primary container for sidenotes.
	 * @param footnotes      Parsed footnote data with ref elements.
	 * @param sizerEl        The .markdown-preview-sizer for position calculation.
	 * @param altContainer   Optional second container for alternating mode (left column).
	 */
	render(
		container: HTMLElement,
		footnotes: ParsedFootnote[],
		sizerEl: HTMLElement,
		altContainer?: HTMLElement
	): void {
		const isAlternating = this.settings.columnLayout === 'alternating' && !!altContainer;
		const sizerRect = sizerEl.getBoundingClientRect();
		const positionMap = this.buildPositionMap(sizerEl);

		for (const fn of footnotes) {
			// Skip if already rendered
			if (fn.refElement.dataset.distillSidenoteRendered) continue;
			fn.refElement.dataset.distillSidenoteRendered = 'true';

			const isNumbered = fn.type !== 'marginnote' && this.settings.showSidenoteNumbers;

			// --- Margin sidenote (absolute-positioned in right column) ---
			const note = document.createElement('div');
			note.className = 'distill-sidenote';
			note.dataset.sidenoteId = fn.id;

			let num = 0;
			if (isNumbered) {
				num = positionMap.get(fn.refElement) ?? 0;

				const numberSpan = document.createElement('span');
				numberSpan.className = 'distill-sidenote-number';
				// 3a: Badge style class
				const badgeStyle = this.settings.numberBadgeStyle;
				if (badgeStyle !== 'superscript') {
					numberSpan.classList.add(`distill-badge-${badgeStyle}`);
				}
				numberSpan.textContent = `${num}`;
				note.appendChild(numberSpan);
			}

			const contentSpan = document.createElement('span');
			contentSpan.className = 'distill-sidenote-content';

			// 1a: Rich markdown — use cloned DOM when available
			if (fn.contentEl) {
				const richClone = fn.contentEl.cloneNode(true) as HTMLElement;
				if (isNumbered) {
					// Prepend a space for separation from the number
					contentSpan.appendChild(document.createTextNode(' '));
				}
				// Append children of the <li> rather than the <li> itself
				while (richClone.firstChild) {
					contentSpan.appendChild(richClone.firstChild);
				}

				// Listen for async image loads to trigger reposition
				const images = contentSpan.querySelectorAll('img');
				for (const img of Array.from(images)) {
					if (!img.complete) {
						img.addEventListener('load', () => {
							this.repositionAfterLoad(sizerEl);
						}, { once: true });
					}
				}
			} else {
				contentSpan.textContent = isNumbered ? ` ${fn.content}` : fn.content;
			}

			note.appendChild(contentSpan);

			// Position aligned with the reference element
			const refRect = fn.refElement.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			note.style.top = refTop;
			note.dataset.refTop = refTop;

			// 3c: In alternating mode, odd notes go left, even go right
			if (isAlternating) {
				const isOdd = this.alternatingIndex % 2 === 0; // 0-indexed: first note is "odd" (left)
				const targetContainer = isOdd ? altContainer : container;
				targetContainer.appendChild(note);
				if (isOdd) {
					this.leftSidenotes.push(note);
				} else {
					this.rightSidenotes.push(note);
				}
				this.alternatingIndex++;
			} else {
				container.appendChild(note);
			}
			this.sidenotes.push(note);
			this.refMap.set(note, fn.refElement);

			// Mark the ref with a matching sidenote ID for cross-referencing
			fn.refElement.dataset.sidenoteId = fn.id;

			if (isNumbered) {
				// --- Superscript number in the text (replacing the original ref style) ---
				this.stylizeRef(fn.refElement, num);
			}

			// 1c: Cross-ref click handlers
			if (this.settings.crossRefClickEnabled) {
				this.addCrossRefHandlers(note, fn.refElement);
			}

			// 1d: Hover highlight handlers
			if (this.settings.hoverHighlight) {
				this.addHoverHighlightHandlers(note, fn.refElement);
			}

			// --- Inline fallback for narrow mode ---
			const inline = this.createInlineFallback(fn, num, isNumbered);
			fn.refElement.after(inline);
			this.inlineNotes.push(inline);
		}

		// Recalculate refTop for ALL sidenotes — earlier render() calls may
		// have computed positions before the DOM was complete (sections arrive
		// incrementally, shifting layout between calls).
		this.recalcAllPositions(sizerEl);

		// Sort by document order then resolve collisions
		this.sortByDocumentOrder();
		if (isAlternating) {
			// Resolve collisions independently per side
			this.sortSubArrayByDocOrder(this.leftSidenotes);
			this.sortSubArrayByDocOrder(this.rightSidenotes);
			resolveCollisions(this.leftSidenotes);
			resolveCollisions(this.rightSidenotes);
		} else {
			resolveCollisions(this.sidenotes);
		}

		// 2a: Apply collapsible behavior to long sidenotes
		if (this.settings.collapsibleSidenotes) {
			this.applyCollapsible();
		}

		// 2b: Apply hover preview mode
		if (this.settings.sidenoteDisplayMode === 'hover') {
			this.applyHoverPreviewMode();
		}

		// Hide original footnotes section now that sidenotes are rendered
		if (this.settings.hideFootnotesSection) {
			const previewView = sizerEl.closest('.markdown-preview-view') as HTMLElement;
			if (previewView) {
				const footnotesSection = previewView.querySelector('section.footnotes') as HTMLElement;
				if (footnotesSection && footnotesSection.style.display !== 'none') {
					footnotesSection.style.display = 'none';
					this.hiddenFootnoteSections.push(footnotesSection);
				}
			}
		}
	}

	/**
	 * Recalculate positions (e.g. after resize or content change).
	 */
	reposition(sizerEl: HTMLElement): void {
		this.recalcAllPositions(sizerEl);
		this.sortByDocumentOrder();
		if (this.settings.columnLayout === 'alternating') {
			this.sortSubArrayByDocOrder(this.leftSidenotes);
			this.sortSubArrayByDocOrder(this.rightSidenotes);
			resolveCollisions(this.leftSidenotes);
			resolveCollisions(this.rightSidenotes);
		} else {
			resolveCollisions(this.sidenotes);
		}
	}

	/**
	 * Recalculate refTop for every sidenote from the current DOM layout.
	 */
	private recalcAllPositions(sizerEl: HTMLElement): void {
		const sizerRect = sizerEl.getBoundingClientRect();
		for (const note of this.sidenotes) {
			const refEl = this.refMap.get(note);
			if (!refEl?.isConnected) continue;
			const refRect = refEl.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			note.style.top = refTop;
			note.dataset.refTop = refTop;
		}
	}

	/** Debounced reposition after image load events. */
	private repositionLoadTimer: ReturnType<typeof setTimeout> | null = null;
	private repositionAfterLoad(sizerEl: HTMLElement): void {
		if (this.repositionLoadTimer) clearTimeout(this.repositionLoadTimer);
		this.repositionLoadTimer = setTimeout(() => {
			this.reposition(sizerEl);
		}, 50);
	}

	/**
	 * Sort this.sidenotes by document order of their reference elements.
	 * This ensures array indices match document order so the collision
	 * resolver's tiebreaker (a.i - b.i) works correctly for same-line notes.
	 */
	private sortByDocumentOrder(): void {
		this.sidenotes.sort((a, b) => {
			const refA = this.refMap.get(a);
			const refB = this.refMap.get(b);
			if (!refA || !refB) return 0;
			const pos = refA.compareDocumentPosition(refB);
			if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
			if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			return 0;
		});
	}

	/** Sort a sub-array of sidenotes by document order. */
	private sortSubArrayByDocOrder(notes: HTMLElement[]): void {
		notes.sort((a, b) => {
			const refA = this.refMap.get(a);
			const refB = this.refMap.get(b);
			if (!refA || !refB) return 0;
			const pos = refA.compareDocumentPosition(refB);
			if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
			if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			return 0;
		});
	}

	private buildPositionMap(sizerEl: HTMLElement): Map<Element, number> {
		const selectors = [
			'sup.footnote-ref a',
			'a[href^="#fn"]',
			'a[href^="#user-content-fn"]',
			'sup[data-footnote-id]',
			'a[data-footnote-ref]',
		];

		const seen = new Set<Element>();
		const refs: Element[] = [];

		for (const selector of selectors) {
			for (const el of Array.from(sizerEl.querySelectorAll(selector))) {
				const refEl = el.closest('sup') || el;
				if (seen.has(refEl)) continue;
				if (refEl.closest('section.footnotes, .footnotes, div.footnotes')) continue;
				seen.add(refEl);
				refs.push(refEl);
			}
		}

		refs.sort((a, b) => {
			const pos = a.compareDocumentPosition(b);
			if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
			if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			return 0;
		});

		const map = new Map<Element, number>();
		refs.forEach((ref, i) => map.set(ref, i + 1));
		return map;
	}

	private stylizeRef(refEl: HTMLElement, num: number): void {
		// Add a data attribute for the sidenote number
		refEl.dataset.distillSidenoteNum = `${num}`;
	}

	/** 1c: Add click-to-scroll between sidenote and its reference. */
	private addCrossRefHandlers(noteEl: HTMLElement, refEl: HTMLElement): void {
		// Click sidenote number → scroll to ref
		const numberSpan = noteEl.querySelector('.distill-sidenote-number');
		if (numberSpan) {
			const handler = (e: Event) => {
				e.preventDefault();
				refEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
			};
			numberSpan.addEventListener('click', handler);
			// No cleanup needed — numberSpan is removed with sidenote
		}

		// Click ref → scroll to sidenote
		const refHandler = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
		};
		refEl.addEventListener('click', refHandler);
		this.eventCleanup.push(() => refEl.removeEventListener('click', refHandler));
	}

	/** 2a: Collapse sidenotes taller than the threshold. */
	private applyCollapsible(): void {
		const threshold = this.settings.sidenoteCollapseHeight;
		for (const note of this.sidenotes) {
			// Skip already-processed notes
			if (note.querySelector('.distill-sidenote-expand')) continue;
			if (note.scrollHeight <= threshold) continue;

			note.classList.add('distill-sidenote-collapsed');
			note.style.maxHeight = `${threshold}px`;

			const btn = document.createElement('button');
			btn.className = 'distill-sidenote-expand';
			btn.textContent = 'Show more';
			btn.addEventListener('click', () => {
				const isCollapsed = note.classList.contains('distill-sidenote-collapsed');
				note.classList.toggle('distill-sidenote-collapsed', !isCollapsed);
				if (isCollapsed) {
					note.style.maxHeight = '';
					btn.textContent = 'Show less';
				} else {
					note.style.maxHeight = `${threshold}px`;
					btn.textContent = 'Show more';
				}
				// Re-resolve collisions — in alternating mode, resolve per-side
				if (this.settings.columnLayout === 'alternating') {
					if (this.leftSidenotes.includes(note)) {
						resolveCollisions(this.leftSidenotes);
					} else {
						resolveCollisions(this.rightSidenotes);
					}
				} else {
					resolveCollisions(this.sidenotes);
				}
			});
			note.appendChild(btn);
		}
	}

	/** 2b: Hide sidenotes until ref is hovered (hover preview mode). */
	private applyHoverPreviewMode(): void {
		for (const note of this.sidenotes) {
			note.classList.add('distill-hover-hidden');

			const refEl = this.refMap.get(note);
			if (!refEl) continue;

			let leaveTimer: ReturnType<typeof setTimeout> | null = null;

			const show = () => {
				if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
				note.classList.add('distill-sidenote-visible');
				note.classList.remove('distill-hover-hidden');
			};
			const startHide = () => {
				leaveTimer = setTimeout(() => {
					note.classList.remove('distill-sidenote-visible');
					note.classList.add('distill-hover-hidden');
				}, 200);
				this.hoverTimers.push(leaveTimer);
			};

			// Show on ref hover
			refEl.addEventListener('mouseenter', show);
			refEl.addEventListener('mouseleave', startHide);
			// Keep visible while hovering the sidenote itself
			note.addEventListener('mouseenter', show);
			note.addEventListener('mouseleave', startHide);

			this.eventCleanup.push(() => {
				refEl.removeEventListener('mouseenter', show);
				refEl.removeEventListener('mouseleave', startHide);
				if (leaveTimer) clearTimeout(leaveTimer);
			});
		}
	}

	/** 1d: Hover highlight between sidenote and its reference. */
	private addHoverHighlightHandlers(noteEl: HTMLElement, refEl: HTMLElement): void {
		// Hover sidenote → highlight ref
		const noteEnter = () => refEl.classList.add('distill-highlight');
		const noteLeave = () => refEl.classList.remove('distill-highlight');
		noteEl.addEventListener('mouseenter', noteEnter);
		noteEl.addEventListener('mouseleave', noteLeave);

		// Hover ref → highlight sidenote
		const refEnter = () => noteEl.classList.add('distill-highlight');
		const refLeave = () => noteEl.classList.remove('distill-highlight');
		refEl.addEventListener('mouseenter', refEnter);
		refEl.addEventListener('mouseleave', refLeave);

		// Cleanup for ref-side listeners (we don't own those elements)
		this.eventCleanup.push(() => {
			refEl.removeEventListener('mouseenter', refEnter);
			refEl.removeEventListener('mouseleave', refLeave);
			refEl.classList.remove('distill-highlight');
		});
	}

	private createInlineFallback(fn: ParsedFootnote, num: number, isNumbered: boolean): HTMLElement {
		if (!isNumbered) {
			// Margin note: always visible in narrow mode, no toggle
			const wrapper = document.createElement('span');
			wrapper.className = 'distill-inline-marginnote';

			const content = document.createElement('span');
			content.className = 'distill-inline-marginnote-content';
			// 1a: Rich content for inline fallback too
			if (fn.contentEl) {
				const richClone = fn.contentEl.cloneNode(true) as HTMLElement;
				while (richClone.firstChild) {
					content.appendChild(richClone.firstChild);
				}
			} else {
				content.textContent = fn.content;
			}

			wrapper.appendChild(content);
			return wrapper;
		}

		// Numbered sidenote: checkbox toggle
		const wrapper = document.createElement('span');
		wrapper.className = 'distill-inline-sidenote';

		// Hidden checkbox
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'distill-inline-toggle';
		checkbox.id = `distill-sn-${fn.id}`;

		// Clickable label (superscript number)
		const label = document.createElement('label');
		label.htmlFor = `distill-sn-${fn.id}`;
		label.className = 'distill-inline-label';
		// 3a: Badge style class for inline label
		const badgeStyle = this.settings.numberBadgeStyle;
		if (badgeStyle !== 'superscript') {
			label.classList.add(`distill-badge-${badgeStyle}`);
		}
		label.textContent = `${num}`;

		// Content (shown when checkbox checked)
		const content = document.createElement('span');
		content.className = 'distill-inline-content';
		// 1a: Rich content for inline fallback too
		if (fn.contentEl) {
			const richClone = fn.contentEl.cloneNode(true) as HTMLElement;
			while (richClone.firstChild) {
				content.appendChild(richClone.firstChild);
			}
		} else {
			content.textContent = fn.content;
		}

		wrapper.appendChild(checkbox);
		wrapper.appendChild(label);
		wrapper.appendChild(content);

		return wrapper;
	}

	/**
	 * Clean up all rendered elements.
	 */
	clear(): void {
		// Run event cleanup (listeners on ref elements we don't own)
		for (const cleanup of this.eventCleanup) cleanup();
		this.eventCleanup = [];

		// Clear any pending hover preview timers
		for (const timer of this.hoverTimers) clearTimeout(timer);
		this.hoverTimers = [];

		for (const note of this.sidenotes) note.remove();
		for (const inline of this.inlineNotes) inline.remove();
		this.sidenotes = [];
		this.leftSidenotes = [];
		this.rightSidenotes = [];
		this.alternatingIndex = 0;
		this.inlineNotes = [];
		this.refMap.clear();

		if (this.repositionLoadTimer) {
			clearTimeout(this.repositionLoadTimer);
			this.repositionLoadTimer = null;
		}

		// Restore hidden footnotes sections
		for (const section of this.hiddenFootnoteSections) {
			if (section.isConnected) {
				section.style.display = '';
			}
		}
		this.hiddenFootnoteSections = [];

		// Clean up data attributes
		document.querySelectorAll('[data-distill-sidenote-rendered]').forEach(el => {
			el.removeAttribute('data-distill-sidenote-rendered');
			el.removeAttribute('data-distill-sidenote-num');
			el.removeAttribute('data-sidenote-id');
		});
	}

	destroy(): void {
		// Restore original {>text} syntax from marker spans before clearing
		document.querySelectorAll('span.distill-sidenote-marker[data-sidenote-content]').forEach(marker => {
			const content = (marker as HTMLElement).dataset.sidenoteContent;
			if (content) {
				const textNode = document.createTextNode(`{>${content}}`);
				marker.parentNode?.replaceChild(textNode, marker);
			}
		});

		this.clear();
	}
}
