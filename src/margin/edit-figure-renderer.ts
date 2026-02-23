import type { DistillLayoutSettings } from '../types';
import type { EditParsedFigure } from './edit-figure-parser';

export class EditFigureRenderer {
	private settings: DistillLayoutSettings;
	private figures: HTMLElement[] = [];

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	render(
		track: HTMLElement,
		figures: EditParsedFigure[],
		cmView: import('@codemirror/view').EditorView,
		contentOffset = 0
	): void {
		this.clear();
		const trackTop = track.getBoundingClientRect().top;
		for (const fig of figures) {
			let top: number | null = null;
			const coords = cmView.coordsAtPos(fig.refOffset);
			if (coords) {
				top = coords.top - trackTop;
			} else {
				try {
					top = cmView.lineBlockAt(fig.refOffset).top + contentOffset;
				} catch { continue; }
			}

			const el = document.createElement('figure');
			el.className = 'distill-margin-figure';
			el.dataset.figureId = fig.id;

			const img = document.createElement('img');
			img.src = fig.imgSrc;
			img.alt = fig.caption || '';
			img.style.maxHeight = `${this.settings.marginFigureMaxHeight}px`;
			el.appendChild(img);

			if (fig.caption) {
				const captionEl = document.createElement('figcaption');
				captionEl.textContent = fig.caption;
				el.appendChild(captionEl);
			}

			el.style.position = 'absolute';
			el.style.top = `${top}px`;
			el.dataset.refTop = `${top}px`;
			el.dataset.refOffset = String(fig.refOffset);

			track.appendChild(el);
			this.figures.push(el);
		}
	}

	getFigures(): HTMLElement[] { return this.figures; }

	clear(): void {
		for (const f of this.figures) f.remove();
		this.figures = [];
	}

	destroy(): void { this.clear(); }
}
