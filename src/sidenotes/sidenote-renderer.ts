import type { ParsedFootnote, DistillLayoutSettings, MarginItem } from '../types';
import type { MarginItemRegistry } from '../margin/margin-item-registry';

/**
 * Creates sidenote elements in the right column, positioned to align
 * with their footnote references. Also creates hidden inline fallbacks
 * for narrow mode.
 */
export class SidenoteRenderer {
	private settings: DistillLayoutSettings;
	private registry: MarginItemRegistry | null;
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
	/** Currently highlighted element for annotation highlighting. */
	private highlightedAnnotation: HTMLElement | null = null;

	constructor(settings: DistillLayoutSettings, registry?: MarginItemRegistry) {
		this.settings = settings;
		this.registry = registry ?? null;
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

			// Bug 2 fix: prevent the original <a> from triggering
			// Obsidian's native scroll-to-anchor (which fires layout-change
			// and tears down sidenotes). We use a handler instead of removing
			// href so that CSS attribute selectors still match on re-parse.
			const refAnchor = fn.refElement.tagName === 'A'
				? fn.refElement as HTMLAnchorElement
				: fn.refElement.querySelector('a') as HTMLAnchorElement | null;
			if (refAnchor) {
				const preventNav = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
				refAnchor.addEventListener('click', preventNav, true); // capture phase
				this.eventCleanup.push(() => refAnchor.removeEventListener('click', preventNav, true));

				if (this.settings.suppressFootnoteHover) {
					const suppressHover = (e: Event) => { e.stopPropagation(); };
					refAnchor.addEventListener('mouseover', suppressHover, true);
					this.eventCleanup.push(() => refAnchor.removeEventListener('mouseover', suppressHover, true));
				}
			}

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

			// Sidenote icon (Feature 16)
			if (fn.icon && this.settings.sidenoteIconsEnabled) {
				const iconSpan = document.createElement('span');
				iconSpan.className = `distill-sidenote-icon distill-sidenote-icon-${fn.icon}`;
				note.appendChild(iconSpan);
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

			// Determine which column this goes into
			let column: 'left' | 'right' = 'right';

			// 3c: In alternating mode, odd notes go left, even go right
			if (isAlternating) {
				const isOdd = this.alternatingIndex % 2 === 0; // 0-indexed: first note is "odd" (left)
				const targetContainer = isOdd ? altContainer : container;
				targetContainer.appendChild(note);
				if (isOdd) {
					this.leftSidenotes.push(note);
					column = 'left';
				} else {
					this.rightSidenotes.push(note);
					column = 'right';
				}
				this.alternatingIndex++;
			} else {
				container.appendChild(note);
			}
			this.sidenotes.push(note);
			this.refMap.set(note, fn.refElement);

			// Register with margin item registry for unified collision resolution
			if (this.registry) {
				const itemType = fn.type === 'marginnote' ? 'marginnote' : 'sidenote';
				this.registry.register({
					element: note,
					refElement: fn.refElement,
					type: itemType,
					id: fn.id,
					column,
				});
			}

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

			// Feature 4: Annotation highlighting on click
			if (this.settings.annotationHighlight) {
				this.addAnnotationHighlightHandler(note, fn.refElement);
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

		// Collision resolution: if registry exists, it handles this in main.ts.
		// Otherwise, fall back to local resolution.
		if (!this.registry) {
			this.sortByDocumentOrder();
			if (isAlternating) {
				this.sortSubArrayByDocOrder(this.leftSidenotes);
				this.sortSubArrayByDocOrder(this.rightSidenotes);
				this.resolveCollisionsLocal(this.leftSidenotes);
				this.resolveCollisionsLocal(this.rightSidenotes);
			} else {
				this.resolveCollisionsLocal(this.sidenotes);
			}
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
		// If registry exists, main.ts calls registry.repositionAll() instead
		if (!this.registry) {
			this.sortByDocumentOrder();
			if (this.settings.columnLayout === 'alternating') {
				this.sortSubArrayByDocOrder(this.leftSidenotes);
				this.sortSubArrayByDocOrder(this.rightSidenotes);
				this.resolveCollisionsLocal(this.leftSidenotes);
				this.resolveCollisionsLocal(this.rightSidenotes);
			} else {
				this.resolveCollisionsLocal(this.sidenotes);
			}
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

	/** Local collision resolution fallback (used when registry is not available). */
	private resolveCollisionsLocal(notes: HTMLElement[], gap = 8): void {
		if (notes.length < 2) return;
		for (const note of notes) {
			if (note.dataset.refTop) {
				note.style.top = note.dataset.refTop;
			}
		}
		for (let i = 1; i < notes.length; i++) {
			const prev = notes[i - 1]!;
			const curr = notes[i]!;
			const prevBottom = parseFloat(prev.style.top) + prev.getBoundingClientRect().height;
			const currTop = parseFloat(curr.style.top);
			if (currTop < prevBottom + gap) {
				curr.style.top = `${prevBottom + gap}px`;
			}
		}
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
		refEl.dataset.distillSidenoteNum = `${num}`;

		// Replace the <a> text with the plugin's number so the ref
		// stays visible (Bug 4 fix). Store original text for cleanup.
		const anchor = refEl.tagName === 'A'
			? refEl as HTMLAnchorElement
			: refEl.querySelector('a') as HTMLAnchorElement | null;
		if (anchor) {
			anchor.dataset.distillOriginalText = anchor.textContent ?? '';
			anchor.textContent = `${num}`;
			anchor.classList.add('distill-ref-number');

			// Apply badge style class to match sidenote number
			const badgeStyle = this.settings.numberBadgeStyle;
			if (badgeStyle !== 'superscript') {
				anchor.classList.add(`distill-badge-${badgeStyle}`);
			}
		}
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

	/** Feature 4: Click sidenote → highlight its source paragraph. */
	private addAnnotationHighlightHandler(noteEl: HTMLElement, refEl: HTMLElement): void {
		const handler = (e: Event) => {
			// Don't interfere with number click (cross-ref)
			if ((e.target as HTMLElement).classList.contains('distill-sidenote-number')) return;
			if ((e.target as HTMLElement).classList.contains('distill-sidenote-expand')) return;

			const block = refEl.closest('p, li, blockquote, .markdown-preview-section > *') as HTMLElement;
			if (!block) return;

			// Toggle off if clicking same annotation
			if (this.highlightedAnnotation === block) {
				block.classList.remove('distill-annotation-highlight');
				this.highlightedAnnotation = null;
				return;
			}

			// Remove previous highlight
			if (this.highlightedAnnotation) {
				this.highlightedAnnotation.classList.remove('distill-annotation-highlight');
			}

			block.classList.add('distill-annotation-highlight');
			this.highlightedAnnotation = block;
		};

		noteEl.addEventListener('click', handler);
		// No cleanup needed — noteEl is removed with sidenote
	}

	/** 2a: Collapse sidenotes taller than the threshold. */
	private applyCollapsible(): void {
		const threshold = this.settings.sidenoteCollapseHeight;
		for (const note of this.sidenotes) {
			// Skip already-processed notes
			if (note.querySelector('.distill-sidenote-expand')) continue;
			if (note.scrollHeight <= threshold) continue;

			// Wrap existing children in an inner div so maxHeight clips
			// the content but the expand button stays visible outside it.
			const inner = document.createElement('div');
			inner.className = 'distill-sidenote-inner';
			while (note.firstChild) {
				inner.appendChild(note.firstChild);
			}
			note.appendChild(inner);

			note.classList.add('distill-sidenote-collapsed');
			inner.style.maxHeight = `${threshold}px`;

			const btn = document.createElement('button');
			btn.className = 'distill-sidenote-expand';
			btn.textContent = 'Show more';
			btn.addEventListener('click', () => {
				const isCollapsed = note.classList.contains('distill-sidenote-collapsed');
				note.classList.toggle('distill-sidenote-collapsed', !isCollapsed);
				if (isCollapsed) {
					inner.style.maxHeight = '';
					btn.textContent = 'Show less';
				} else {
					inner.style.maxHeight = `${threshold}px`;
					btn.textContent = 'Show more';
				}
				// Re-resolve collisions via registry or local
				if (this.registry) {
					this.registry.resolveAll();
				} else if (this.settings.columnLayout === 'alternating') {
					if (this.leftSidenotes.includes(note)) {
						this.resolveCollisionsLocal(this.leftSidenotes);
					} else {
						this.resolveCollisionsLocal(this.rightSidenotes);
					}
				} else {
					this.resolveCollisionsLocal(this.sidenotes);
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

		// Clear annotation highlight
		if (this.highlightedAnnotation) {
			this.highlightedAnnotation.classList.remove('distill-annotation-highlight');
			this.highlightedAnnotation = null;
		}

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

		// Unregister sidenotes from registry
		if (this.registry) {
			this.registry.unregisterByType('sidenote');
			this.registry.unregisterByType('marginnote');
		}

		// Restore hidden footnotes sections
		for (const section of this.hiddenFootnoteSections) {
			if (section.isConnected) {
				section.style.display = '';
			}
		}
		this.hiddenFootnoteSections = [];

		// Clean up data attributes and restore original ref state
		document.querySelectorAll('[data-distill-sidenote-rendered]').forEach(el => {
			// Restore original <a> text content (Bug 4 cleanup)
			const anchor = el.tagName === 'A'
				? el as HTMLAnchorElement
				: el.querySelector('a') as HTMLAnchorElement | null;
			if (anchor) {
				const origText = anchor.dataset.distillOriginalText;
				if (origText !== undefined) {
					anchor.textContent = origText;
					delete anchor.dataset.distillOriginalText;
				}
				anchor.classList.remove('distill-ref-number', 'distill-badge-circled', 'distill-badge-pill');
			}

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
