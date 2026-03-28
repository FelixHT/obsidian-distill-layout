import type { ParsedFootnote, DistillLayoutSettings } from '../types';
import type { MarginItemRegistry } from '../margin/margin-item-registry';
import type { EditParsedFootnote } from './edit-footnote-parser';
import { MarkdownRenderer, Component } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Creates sidenote elements in the right column, positioned to align
 * with their footnote references. Also creates hidden inline fallbacks
 * for narrow mode.
 */
export class SidenoteRenderer {
	private settings: DistillLayoutSettings;
	private app: App | null;
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
	/** @deprecated — hover timers are now cleaned up per-note via eventCleanup closures. */
	/** Running index for alternating mode — persists across incremental render() calls. */
	private alternatingIndex = 0;
	/** Currently highlighted element for annotation highlighting. */
	private highlightedAnnotation: HTMLElement | null = null;
	/** Track rendered sidenote IDs in memory — immune to Obsidian section virtualization. */
	private renderedIds = new Set<string>();
	/** Components created by MarkdownRenderer.render() in preRender(), must be unloaded on clear(). */
	private preRenderComponents: Component[] = [];

	constructor(settings: DistillLayoutSettings, registry?: MarginItemRegistry, app?: App) {
		this.settings = settings;
		this.app = app ?? null;
		this.registry = registry ?? null;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	getRenderedCount(): number {
		return this.renderedIds.size;
	}

	/**
	 * Pre-create sidenotes from source-parsed data with estimated positions.
	 * Called on file-open before the full DOM is available, so sidenotes exist
	 * immediately for the entire document. Positions are corrected later by
	 * upgradePreCreated() when real DOM sections render.
	 *
	 * @param container      The primary container for sidenotes (scroll-synced track).
	 * @param items          Edit-parsed footnotes from parseEditFootnotes().
	 * @param sizerHeight    scrollHeight of the preview sizer for position estimation.
	 * @param totalLines     Total line count in the source document.
	 * @param altContainer   Optional second container for alternating mode (left track).
	 */
	preRender(
		container: HTMLElement,
		items: EditParsedFootnote[],
		sizerHeight: number,
		totalLines: number,
		altContainer?: HTMLElement,
		sourceText?: string
	): void {
		const isAlternating = this.settings.columnLayout === 'alternating' && !!altContainer;

		// Build a mapping from source footnote IDs to Obsidian's sequential
		// DOM numbering. Obsidian renumbers all footnotes sequentially (1, 2, 3…)
		// by order of first reference. Without this mapping, preRender() would
		// register e.g. "longer" in renderedIds but render() would look for "3",
		// causing duplicates.
		const seqMap = new Map<string, string>();
		if (sourceText) {
			const seen = new Set<string>();
			const order: string[] = [];
			const refRegex = /\[\^([^\]]+)\](?!:)/g;
			let m;
			while ((m = refRegex.exec(sourceText)) !== null) {
				const refId = m[1]!;
				const lineStart = sourceText.lastIndexOf('\n', m.index - 1) + 1;
				const lineText = sourceText.slice(lineStart, sourceText.indexOf('\n', m.index));
				if (/^\[\^[^\]]+\]:/.test(lineText)) continue;
				if (!seen.has(refId)) {
					seen.add(refId);
					order.push(refId);
				}
			}
			for (let i = 0; i < order.length; i++) {
				seqMap.set(order[i]!, String(i + 1));
			}
		}

		for (const item of items) {
			// Normalize ID: strip `edit-` prefix so reading-mode IDs match.
			// edit-custom-HASH → custom-HASH; standard footnote IDs have no prefix.
			let id = item.id.startsWith('edit-') ? item.id.slice(5) : item.id;

			// For standard footnotes (not custom syntax), use the sequential ID
			// that Obsidian's DOM will produce, so renderedIds matches render().
			if (item.type !== 'marginnote' && seqMap.has(id)) {
				id = seqMap.get(id)!;
			}

			if (this.renderedIds.has(id)) continue;
			this.renderedIds.add(id);

			const isNumbered = item.type !== 'marginnote' && this.settings.showSidenoteNumbers;

			// Create DOM element — same structure as render()
			const note = document.createElement('div');
			note.className = 'distill-sidenote distill-sidenote-estimated';
			note.dataset.sidenoteId = id;
			note.dataset.preCreated = 'true';
			note.dataset.refLine = String(item.refLine);

			if (isNumbered) {
				const numberSpan = document.createElement('span');
				numberSpan.className = 'distill-sidenote-number';
				const badgeStyle = this.settings.numberBadgeStyle;
				if (badgeStyle !== 'superscript') {
					numberSpan.classList.add(`distill-badge-${badgeStyle}`);
				}
				// Temporary sequential number — will be corrected on upgrade
				numberSpan.textContent = '·';
				note.appendChild(numberSpan);
			}

			// Sidenote icon
			if (item.icon && this.settings.sidenoteIconsEnabled) {
				const iconSpan = document.createElement('span');
				iconSpan.className = `distill-sidenote-icon distill-sidenote-icon-${item.icon}`;
				note.appendChild(iconSpan);
			}

			const contentSpan = document.createElement('span');
			contentSpan.className = 'distill-sidenote-content';

			// Render markdown content if app is available, otherwise plain text
			if (this.app && item.content) {
				const wrapper = document.createElement('div');
				const comp = new Component();
				comp.load();
				this.preRenderComponents.push(comp);
				void MarkdownRenderer.render(this.app, item.content, wrapper, '', comp);
				if (isNumbered) contentSpan.appendChild(document.createTextNode(' '));
				while (wrapper.firstChild) {
					contentSpan.appendChild(wrapper.firstChild);
				}
			} else {
				contentSpan.textContent = isNumbered ? ` ${item.content}` : item.content;
			}

			note.appendChild(contentSpan);

			// Estimate position: (refLine / totalLines) * sizerHeight
			const estimatedTop = (item.refLine / Math.max(totalLines, 1)) * sizerHeight;
			note.style.top = `${estimatedTop}px`;
			note.dataset.refTop = `${estimatedTop}px`;

			// Determine column
			let column: 'left' | 'right' = 'right';
			if (isAlternating) {
				const isOdd = this.alternatingIndex % 2 === 0;
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

			// Create detached placeholder ref for refMap
			const placeholderRef = document.createElement('span');
			this.refMap.set(note, placeholderRef);

			// Register in MarginItemRegistry with detached placeholder
			if (this.registry) {
				const itemType = item.type === 'marginnote' ? 'marginnote' : 'sidenote';
				this.registry.register({
					element: note,
					refElement: placeholderRef,
					type: itemType,
					id,
					column,
				});
			}
		}

		// Assign sequential numbers based on document order (by refLine)
		if (this.settings.showSidenoteNumbers) {
			const numbered = this.sidenotes
				.filter(n => n.dataset.preCreated === 'true' && n.querySelector('.distill-sidenote-number'))
				.sort((a, b) => parseInt(a.dataset.refLine || '0', 10) - parseInt(b.dataset.refLine || '0', 10));
			numbered.forEach((note, i) => {
				const numSpan = note.querySelector('.distill-sidenote-number');
				if (numSpan) numSpan.textContent = `${i + 1}`;
			});
		}

		// Collision resolution
		if (this.registry) {
			this.registry.resolveAll();
		} else {
			if (isAlternating) {
				this.resolveCollisionsLocal(this.leftSidenotes);
				this.resolveCollisionsLocal(this.rightSidenotes);
			} else {
				this.resolveCollisionsLocal(this.sidenotes);
			}
		}

		// Collapsible
		if (this.settings.collapsibleSidenotes) {
			this.applyCollapsible();
		}

		// Hover preview mode
		if (this.settings.sidenoteDisplayMode === 'hover') {
			this.applyHoverPreviewMode();
		}
	}

	/**
	 * Upgrade a pre-created sidenote with the real DOM ref element.
	 * Called when render() detects a pre-created sidenote for a ParsedFootnote
	 * whose section has become visible in the DOM.
	 */
	private upgradePreCreated(note: HTMLElement, fn: ParsedFootnote, sizerEl: HTMLElement): void {
		// Update refMap with real ref element
		this.refMap.set(note, fn.refElement);
		fn.refElement.dataset.sidenoteId = fn.id;

		// Recalculate position from real DOM element
		const sizerRect = sizerEl.getBoundingClientRect();
		const refRect = fn.refElement.getBoundingClientRect();
		const refTop = `${refRect.top - sizerRect.top}px`;
		note.style.top = refTop;
		note.dataset.refTop = refTop;

		// Remove pre-created markers (triggers CSS transition)
		delete note.dataset.preCreated;
		delete note.dataset.refLine;
		note.classList.remove('distill-sidenote-estimated');

		// Update registry ref element
		if (this.registry) {
			this.registry.updateRefElement(fn.id, fn.refElement);
		}

		// If rich content is available from DOM, upgrade the content span
		if (fn.contentEl) {
			const contentSpan = note.querySelector('.distill-sidenote-content') as HTMLElement;
			if (contentSpan) {
				const isNumbered = fn.type !== 'marginnote' && this.settings.showSidenoteNumbers;
				contentSpan.textContent = '';
				const richClone = fn.contentEl.cloneNode(true) as HTMLElement;
				if (isNumbered) {
					contentSpan.appendChild(document.createTextNode(' '));
				}
				while (richClone.firstChild) {
					contentSpan.appendChild(richClone.firstChild);
				}
			}
		}

		// Apply ref styling and interactions (these need the real ref element)
		const isNumbered = fn.type !== 'marginnote' && this.settings.showSidenoteNumbers;
		const positionMap = isNumbered ? this.buildPositionMap(sizerEl) : null;
		const num = (positionMap && positionMap.get(fn.refElement)) ?? 0;
		if (isNumbered) {
			this.stylizeRef(fn.refElement, num);
		}

		// Prevent native footnote navigation
		const refAnchor = fn.refElement instanceof HTMLAnchorElement
			? fn.refElement
			: fn.refElement.querySelector<HTMLAnchorElement>('a');
		if (refAnchor) {
			const preventNav = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
			refAnchor.addEventListener('click', preventNav, true);
			this.eventCleanup.push(() => refAnchor.removeEventListener('click', preventNav, true));

			if (this.settings.suppressFootnoteHover) {
				const suppressHover = (e: Event) => { e.stopPropagation(); };
				refAnchor.addEventListener('mouseover', suppressHover, true);
				this.eventCleanup.push(() => refAnchor.removeEventListener('mouseover', suppressHover, true));
			}
		}

		// Cross-ref click handlers
		if (this.settings.crossRefClickEnabled) {
			this.addCrossRefHandlers(note, fn.refElement);
		}

		// Hover highlight
		if (this.settings.hoverHighlight) {
			this.addHoverHighlightHandlers(note, fn.refElement);
		}

		// Annotation highlighting
		if (this.settings.annotationHighlight) {
			this.addAnnotationHighlightHandler(note, fn.refElement);
		}

		// Insert inline fallback after the real ref element
		const inline = this.createInlineFallback(fn, num, isNumbered);
		inline.dataset.sidenoteId = fn.id;
		fn.refElement.after(inline);
		this.inlineNotes.push(inline);

		// Renumber all sidenotes after upgrade — late-arriving sections may
		// shift the numbering of previously rendered sidenotes.
		this.renumber(sizerEl);
	}

	/**
	 * Recalculate all sidenote numbers based on current DOM order.
	 * Call after late-arriving sections add new sidenotes, which may
	 * shift the numbering of previously rendered ones.
	 */
	renumber(sizerEl: HTMLElement): void {
		if (!this.settings.showSidenoteNumbers) return;
		const positionMap = this.buildPositionMap(sizerEl);

		// Build a unified numbering that includes pre-created items.
		// Upgraded (real-ref) sidenotes use buildPositionMap; pre-created
		// ones are sorted by refTop and interleaved by position.
		const upgradedNotes: Array<{ note: HTMLElement; refEl: HTMLElement; top: number }> = [];
		const preCreatedNotes: Array<{ note: HTMLElement; top: number }> = [];

		for (const note of this.sidenotes) {
			if (!note.querySelector('.distill-sidenote-number')) continue;
			if (note.dataset.preCreated === 'true') {
				preCreatedNotes.push({ note, top: parseFloat(note.dataset.refTop || '0') });
			} else {
				const refEl = this.refMap.get(note);
				if (!refEl) continue;
				const num = positionMap.get(refEl);
				if (num == null) continue;
				const refRect = refEl.isConnected ? refEl.getBoundingClientRect() : null;
				const sizerRect = sizerEl.getBoundingClientRect();
				const top = refRect ? refRect.top - sizerRect.top : parseFloat(note.dataset.refTop || '0');
				upgradedNotes.push({ note, refEl, top });
			}
		}

		// Merge both lists sorted by vertical position
		const all = [
			...upgradedNotes.map(u => ({ ...u, isPreCreated: false as const })),
			...preCreatedNotes.map(p => ({ ...p, refEl: undefined, isPreCreated: true as const })),
		].sort((a, b) => a.top - b.top);

		let counter = 1;
		for (const item of all) {
			const numberSpan = item.note.querySelector('.distill-sidenote-number');
			if (numberSpan) numberSpan.textContent = `${counter}`;

			if (!item.isPreCreated && item.refEl) {
				item.refEl.dataset.distillSidenoteNum = `${counter}`;
				const anchor = item.refEl instanceof HTMLAnchorElement
					? item.refEl
					: item.refEl.querySelector<HTMLAnchorElement>('a');
				if (anchor?.classList.contains('distill-ref-number')) {
					anchor.textContent = `${counter}`;
				}
			}
			counter++;
		}
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
		let addedNew = false;

		for (const fn of footnotes) {
			// Skip if already rendered — but check connectivity first.
			// When the virtualizer unloads a section, the sidenote DOM element
			// may become disconnected while renderedIds still has the ID.
			if (this.renderedIds.has(fn.id)) {
				const existing = this.sidenotes.find(n => n.dataset.sidenoteId === fn.id);
				if (existing?.isConnected) {
					// Pre-created sidenote → upgrade with real DOM ref
					if (existing.dataset.preCreated === 'true') {
						this.upgradePreCreated(existing, fn, sizerEl);
						addedNew = true; // trigger post-render recalc
						continue;
					}
					// Sidenote still live — update ref mapping if refElement changed
					const oldRef = this.refMap.get(existing);
					if (oldRef && !oldRef.isConnected && fn.refElement.isConnected) {
						this.refMap.set(existing, fn.refElement);
						fn.refElement.dataset.sidenoteId = fn.id;
					}
					continue;
				}
				// Stale entry — clean up and fall through to re-render
				this.renderedIds.delete(fn.id);
				this.sidenotes = this.sidenotes.filter(n => n !== existing);
				if (existing) this.refMap.delete(existing);
				this.leftSidenotes = this.leftSidenotes.filter(n => n !== existing);
				this.rightSidenotes = this.rightSidenotes.filter(n => n !== existing);
				if (this.registry) this.registry.unregisterById(fn.id);
			}
			this.renderedIds.add(fn.id);
			addedNew = true;

			// Bug 2 fix: prevent the original <a> from triggering
			// Obsidian's native scroll-to-anchor (which fires layout-change
			// and tears down sidenotes). We use a handler instead of removing
			// href so that CSS attribute selectors still match on re-parse.
			const refAnchor = fn.refElement instanceof HTMLAnchorElement
				? fn.refElement
				: fn.refElement.querySelector<HTMLAnchorElement>('a');
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
			inline.dataset.sidenoteId = fn.id;
			fn.refElement.after(inline);
			this.inlineNotes.push(inline);
		}

		// Only do post-render work if new sidenotes were actually created.
		// Calling recalcAllPositions when nothing changed would reset
		// collision-resolved positions back to raw refTop, causing overlaps.
		if (!addedNew) return;

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
				if (footnotesSection && !footnotesSection.classList.contains('distill-hidden')) {
					footnotesSection.classList.add('distill-hidden');
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
			// Fall back to refTop when either ref is disconnected (pre-created)
			if (!refA.isConnected || !refB.isConnected) {
				return parseFloat(a.dataset.refTop || '0') - parseFloat(b.dataset.refTop || '0');
			}
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
			if (!refA.isConnected || !refB.isConnected) {
				return parseFloat(a.dataset.refTop || '0') - parseFloat(b.dataset.refTop || '0');
			}
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
		const anchor = refEl instanceof HTMLAnchorElement
			? refEl
			: refEl.querySelector<HTMLAnchorElement>('a');
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

	/** 1c: Add click-to-scroll between sidenote and its reference.
	 *
	 * Elements live inside a transform-translated column with overflow:hidden,
	 * so scrollIntoView() targets the wrong container. Instead, scroll the
	 * main .markdown-preview-view directly using scrollTo().
	 */
	private addCrossRefHandlers(noteEl: HTMLElement, refEl: HTMLElement): void {
		// Click sidenote number → scroll to ref
		const numberSpan = noteEl.querySelector('.distill-sidenote-number');
		if (numberSpan) {
			const handler = (e: Event) => {
				e.preventDefault();
				const previewView = refEl.closest('.markdown-preview-view') as HTMLElement;
				if (!previewView) return;
				const sizer = previewView.querySelector('.markdown-preview-sizer') as HTMLElement;
				if (!sizer) return;
				const sizerRect = sizer.getBoundingClientRect();
				const refRect = refEl.getBoundingClientRect();
				const refDocTop = refRect.top - sizerRect.top;
				const viewportHeight = previewView.clientHeight;
				previewView.scrollTo({ top: refDocTop - viewportHeight / 2, behavior: 'smooth' });
			};
			numberSpan.addEventListener('click', handler);
			// No cleanup needed — numberSpan is removed with sidenote
		}

		// Click ref → scroll so sidenote region is visible
		const refHandler = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			const previewView = refEl.closest('.markdown-preview-view') as HTMLElement;
			if (!previewView) return;
			// noteEl.style.top is in document coordinates (relative to sizer)
			const noteDocTop = parseFloat(noteEl.style.top) || 0;
			const viewportHeight = previewView.clientHeight;
			previewView.scrollTo({ top: noteDocTop - viewportHeight / 3, behavior: 'smooth' });
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
			inner.style.setProperty('--distill-collapse-height', `${threshold}px`);

			const btn = document.createElement('button');
			btn.className = 'distill-sidenote-expand';
			btn.textContent = 'Show more';
			btn.addEventListener('click', () => {
				const isCollapsed = note.classList.toggle('distill-sidenote-collapsed');
				btn.textContent = isCollapsed ? 'Show more' : 'Show less';
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
			// Guard: skip notes that already have hover handlers set up
			if (note.dataset.distillHoverSetup === 'true') continue;

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
			};

			// Show on ref hover
			refEl.addEventListener('mouseenter', show);
			refEl.addEventListener('mouseleave', startHide);
			// Keep visible while hovering the sidenote itself
			note.addEventListener('mouseenter', show);
			note.addEventListener('mouseleave', startHide);

			note.dataset.distillHoverSetup = 'true';

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
	 * Create inline fallbacks for any pre-created sidenotes that were never
	 * upgraded (and thus never got inline fallbacks). Uses the DOM marker
	 * elements as ref points for insertion.
	 */
	ensureInlineFallbacks(previewSizer: HTMLElement): void {
		// Track IDs that already have inline fallbacks (including those from render/upgrade)
		const existingInlineIds = new Set<string>();
		for (const n of this.inlineNotes) {
			const sid = n.dataset.sidenoteId;
			if (sid) existingInlineIds.add(sid);
			const checkbox = n.querySelector('.distill-inline-toggle') as HTMLInputElement;
			if (checkbox?.id) existingInlineIds.add(checkbox.id.replace('distill-sn-', ''));
		}

		// Build a list of available markers (by data-sidenote-id or by hash)
		const markerById = new Map<string, HTMLElement[]>();
		const allMarkers = previewSizer.querySelectorAll<HTMLElement>('.distill-sidenote-marker[data-sidenote-content]');
		for (const el of Array.from(allMarkers)) {
			// Use existing sidenote-id if set, otherwise compute hash
			const markerId = el.dataset.sidenoteId
				?? `custom-${this.hashContent(el.dataset.sidenoteContent!)}`;
			if (!markerById.has(markerId)) markerById.set(markerId, []);
			markerById.get(markerId)!.push(el);
		}

		for (const note of this.sidenotes) {
			const id = note.dataset.sidenoteId;
			if (!id) continue;
			if (existingInlineIds.has(id)) continue;

			// Find a ref element for this sidenote
			let refElement: HTMLElement | null = null;

			// Try direct ID match first (works for footnotes and tagged markers)
			const byId = previewSizer.querySelector(`[data-sidenote-id="${CSS.escape(id)}"]`) as HTMLElement;
			if (byId) {
				// Verify no inline fallback already adjacent
				const next = byId.nextElementSibling;
				if (next && (next.classList.contains('distill-inline-marginnote')
					|| next.classList.contains('distill-inline-sidenote'))) {
					existingInlineIds.add(id);
					continue;
				}
				refElement = byId;
			}

			// Try hash-based lookup (consume from queue for duplicate-content sidenotes)
			if (!refElement) {
				// Strip suffix like -1, -2 for duplicate IDs to find the base hash
				const baseId = id.replace(/-\d+$/, '');
				const queue = markerById.get(id) ?? markerById.get(baseId);
				if (queue && queue.length > 0) {
					const candidate = queue.shift()!;
					const next = candidate.nextElementSibling;
					if (next && (next.classList.contains('distill-inline-marginnote')
						|| next.classList.contains('distill-inline-sidenote'))) {
						existingInlineIds.add(id);
						continue;
					}
					refElement = candidate;
				}
			}

			if (!refElement) continue;

			refElement.dataset.sidenoteId = id;

			// Detect whether this is a numbered sidenote or a margin note
			const numberSpan = note.querySelector('.distill-sidenote-number');
			const isNumbered = !!numberSpan;
			const num = isNumbered ? parseInt(numberSpan!.textContent || '0', 10) : 0;
			const type = isNumbered ? 'sidenote' : 'marginnote';

			const contentSpan = note.querySelector('.distill-sidenote-content');
			const fakeFn = {
				id,
				refElement,
				content: contentSpan?.textContent ?? '',
				contentEl: contentSpan ? contentSpan.cloneNode(true) as HTMLElement : undefined,
				type: type as 'sidenote' | 'marginnote',
				icon: undefined,
			};

			const inline = this.createInlineFallback(fakeFn as ParsedFootnote, num, isNumbered);
			inline.dataset.sidenoteId = id;
			refElement.after(inline);
			this.inlineNotes.push(inline);
			existingInlineIds.add(id);
		}
	}

	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
		}
		return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
	}

	/**
	 * Clean up all rendered elements.
	 */
	clear(): void {
		// Run event cleanup (listeners on ref elements we don't own;
		// also clears per-note hover leaveTimers via their closures)
		for (const cleanup of this.eventCleanup) cleanup();
		this.eventCleanup = [];

		// Clean up hover-setup markers so re-applied hover mode works
		for (const note of this.sidenotes) {
			delete note.dataset.distillHoverSetup;
		}

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
		this.renderedIds.clear();

		// Unload MarkdownRenderer components from preRender()
		for (const comp of this.preRenderComponents) comp.unload();
		this.preRenderComponents = [];

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
				section.classList.remove('distill-hidden');
			}
		}
		this.hiddenFootnoteSections = [];

		// Clean up data attributes and restore original ref state.
		// stylizeRef() sets data-distill-original-text on <a> elements,
		// so query by that attribute to find refs that need cleanup.
		document.querySelectorAll<HTMLAnchorElement>('a[data-distill-original-text]').forEach(anchor => {
			const origText = anchor.dataset.distillOriginalText;
			if (origText !== undefined) {
				anchor.textContent = origText;
				anchor.removeAttribute('data-distill-original-text');
			}
			anchor.classList.remove('distill-ref-number', 'distill-badge-circled', 'distill-badge-pill');

			// Also clean up the parent ref element's attributes
			const refEl = anchor.closest('[data-distill-sidenote-num]') ?? anchor.parentElement;
			if (refEl) {
				refEl.removeAttribute('data-distill-sidenote-num');
				refEl.removeAttribute('data-sidenote-id');
			}
		});
	}

	destroy(): void {
		// Restore original {>text} or {>!icon: text} syntax from marker spans before clearing
		document.querySelectorAll<HTMLElement>('span.distill-sidenote-marker[data-sidenote-content]').forEach(marker => {
			const content = marker.dataset.sidenoteContent;
			const icon = marker.dataset.sidenoteIcon;
			if (content) {
				const restored = icon ? `{>!${icon}: ${content}}` : `{>${content}}`;
				const textNode = document.createTextNode(restored);
				marker.parentNode?.replaceChild(textNode, marker);
			}
		});

		this.clear();
	}
}
