import type { DistillLayoutSettings } from '../types';
import type { EditParsedFootnote } from './edit-footnote-parser';
import { resolveCollisions } from './collision-resolver';

/**
 * Renders sidenotes in the edit-mode scroll track, positioned via
 * CM6 geometry (`lineBlockAt`).
 *
 * Unlike the preview-mode SidenoteRenderer, this doesn't create
 * inline fallbacks (we can't inject into CM content) and doesn't
 * hide a footnotes section (it doesn't exist in source mode).
 */
export class EditSidenoteRenderer {
	private settings: DistillLayoutSettings;
	private sidenotes: HTMLElement[] = [];

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	/**
	 * Render sidenotes into the track div using CM6 line geometry.
	 * @param track       The `.distill-edit-sidenote-track` element.
	 * @param footnotes   Parsed footnote data from text.
	 * @param cmView      The CM6 EditorView for geometry lookups.
	 */
	render(
		track: HTMLElement,
		footnotes: EditParsedFootnote[],
		cmView: import('@codemirror/view').EditorView
	): void {
		this.clear();

		if (footnotes.length === 0) return;

		let sidenoteIndex = 0;

		for (const fn of footnotes) {
			const isNumbered = fn.type !== 'marginnote' && this.settings.showSidenoteNumbers;

			// Get the pixel offset of the reference line
			let top = 0;
			try {
				const block = cmView.lineBlockAt(fn.refOffset);
				top = block.top;
			} catch {
				continue;
			}

			const note = document.createElement('div');
			note.className = 'distill-sidenote';
			note.dataset.sidenoteId = fn.id;

			if (isNumbered) {
				sidenoteIndex++;
				const numberSpan = document.createElement('span');
				numberSpan.className = 'distill-sidenote-number';
				const badgeStyle = this.settings.numberBadgeStyle;
				if (badgeStyle !== 'superscript') {
					numberSpan.classList.add(`distill-badge-${badgeStyle}`);
				}
				numberSpan.textContent = `${sidenoteIndex}`;

				// Cross-ref click: scroll to the reference in the editor
				if (this.settings.crossRefClickEnabled) {
					numberSpan.addEventListener('click', (e) => {
						e.preventDefault();
						const { EditorView } = require('@codemirror/view');
						cmView.dispatch({
							effects: EditorView.scrollIntoView(fn.refOffset, { y: 'center' }),
						});
					});
				}

				note.appendChild(numberSpan);
			}

			const contentSpan = document.createElement('span');
			contentSpan.className = 'distill-sidenote-content';
			contentSpan.textContent = isNumbered ? ` ${fn.content}` : fn.content;
			note.appendChild(contentSpan);

			// Position absolutely within the track
			note.style.position = 'absolute';
			note.style.top = `${top}px`;
			note.dataset.refTop = `${top}px`;

			track.appendChild(note);
			this.sidenotes.push(note);
		}

		// Resolve vertical collisions
		resolveCollisions(this.sidenotes);

		// Apply collapsible behavior
		if (this.settings.collapsibleSidenotes) {
			this.applyCollapsible();
		}
	}

	private applyCollapsible(): void {
		const threshold = this.settings.sidenoteCollapseHeight;
		for (const note of this.sidenotes) {
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
				resolveCollisions(this.sidenotes);
			});
			note.appendChild(btn);
		}
	}

	clear(): void {
		for (const note of this.sidenotes) note.remove();
		this.sidenotes = [];
	}

	destroy(): void {
		this.clear();
	}
}
