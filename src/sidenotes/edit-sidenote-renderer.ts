import { EditorView } from '@codemirror/view';
import type { DistillLayoutSettings } from '../types';
import type { EditParsedFootnote } from './edit-footnote-parser';

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
	 * @param track          The `.distill-edit-sidenote-track` element.
	 * @param footnotes      Parsed footnote data from text.
	 * @param cmView         The CM6 EditorView for geometry lookups.
	 * @param contentOffset  Pixel offset from track origin to .cm-content origin.
	 */
	render(
		track: HTMLElement,
		footnotes: EditParsedFootnote[],
		cmView: EditorView,
		contentOffset = 0
	): void {
		this.clear();

		if (footnotes.length === 0) return;

		const trackTop = track.getBoundingClientRect().top;
		let sidenoteIndex = 0;

		for (const fn of footnotes) {
			const isNumbered = fn.type !== 'marginnote' && this.settings.showSidenoteNumbers;

			// Get the pixel offset of the reference line.
			// Prefer coordsAtPos (DOM-accurate, accounts for rendered widgets)
			// with lineBlockAt as fallback for off-screen positions.
			let top: number | null = null;
			const coords = cmView.coordsAtPos(fn.refOffset);
			if (coords) {
				top = coords.top - trackTop;
			} else {
				try {
					top = cmView.lineBlockAt(fn.refOffset).top + contentOffset;
				} catch {
					continue;
				}
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
						cmView.dispatch({
							effects: EditorView.scrollIntoView(fn.refOffset, { y: 'center' }),
						});
					});
				}

				note.appendChild(numberSpan);
			}

			// Icon rendering for {>!icon: text} syntax
			if (fn.icon) {
				const iconSpan = document.createElement('span');
				iconSpan.className = 'distill-sidenote-icon';
				iconSpan.textContent = this.getIconEmoji(fn.icon);
				note.appendChild(iconSpan);
			}

			const contentSpan = document.createElement('span');
			contentSpan.className = 'distill-sidenote-content';
			contentSpan.textContent = isNumbered ? ` ${fn.content}` : fn.content;
			note.appendChild(contentSpan);

			// Position absolutely within the track
			note.classList.add('distill-position-absolute');
			note.style.top = `${top}px`;
			note.dataset.refTop = `${top}px`;
			note.dataset.refOffset = String(fn.refOffset);

			track.appendChild(note);
			this.sidenotes.push(note);
		}

		// Apply collapsible behavior
		if (this.settings.collapsibleSidenotes) {
			this.applyCollapsible();
		}
	}

	getSidenotes(): HTMLElement[] {
		return this.sidenotes;
	}

	private getIconEmoji(icon: string): string {
		const map: Record<string, string> = {
			warning: '\u26A0\uFE0F',
			info: '\u2139\uFE0F',
			tip: '\uD83D\uDCA1',
			note: '\uD83D\uDCDD',
			question: '\u2753',
		};
		return map[icon.toLowerCase()] || `[${icon}]`;
	}

	private applyCollapsible(): void {
		const threshold = this.settings.sidenoteCollapseHeight;
		for (const note of this.sidenotes) {
			if (note.scrollHeight <= threshold) continue;

			note.classList.add('distill-sidenote-collapsed');
			note.style.setProperty('--distill-collapse-height', `${threshold}px`);

			const btn = document.createElement('button');
			btn.className = 'distill-sidenote-expand';
			btn.textContent = 'Show more';
			btn.addEventListener('click', () => {
				const isCollapsed = note.classList.toggle('distill-sidenote-collapsed');
				btn.textContent = isCollapsed ? 'Show more' : 'Show less';
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
