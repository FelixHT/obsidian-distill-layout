import type { DistillLayoutSettings, MarginItem } from '../types';
import type { MarginItemRegistry } from './margin-item-registry';
import type { ParsedFigure } from './figure-parser';

/**
 * Renders margin figures from parsed {>fig:...} syntax.
 * Creates <figure> elements with images and captions in the margin column.
 */
export class FigureRenderer {
	private settings: DistillLayoutSettings;
	private registry: MarginItemRegistry;
	private figures: HTMLElement[] = [];
	private inlineFigures: HTMLElement[] = [];

	constructor(settings: DistillLayoutSettings, registry: MarginItemRegistry) {
		this.settings = settings;
		this.registry = registry;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	render(
		container: HTMLElement,
		figures: ParsedFigure[],
		sizerEl: HTMLElement,
		column: 'left' | 'right' = 'right'
	): void {
		const sizerRect = sizerEl.getBoundingClientRect();

		for (const fig of figures) {
			if (fig.refElement.dataset.distillFigureRendered) continue;
			fig.refElement.dataset.distillFigureRendered = 'true';

			const figureEl = document.createElement('figure');
			figureEl.className = 'distill-margin-figure';
			figureEl.dataset.figureId = fig.id;

			const img = document.createElement('img');
			img.src = fig.imgSrc;
			img.alt = fig.caption || '';
			img.style.maxHeight = `${this.settings.marginFigureMaxHeight}px`;
			img.addEventListener('load', () => {
				// Reposition after image loads
				this.registry.resolveAll();
			}, { once: true });

			figureEl.appendChild(img);

			if (fig.caption) {
				const captionEl = document.createElement('figcaption');
				captionEl.textContent = fig.caption;
				figureEl.appendChild(captionEl);
			}

			// Position
			const refRect = fig.refElement.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			figureEl.style.top = refTop;
			figureEl.dataset.refTop = refTop;

			container.appendChild(figureEl);
			this.figures.push(figureEl);

			// Register with registry
			this.registry.register({
				element: figureEl,
				refElement: fig.refElement,
				type: 'figure',
				id: fig.id,
				column,
			});

			// Inline fallback for narrow mode
			const inline = document.createElement('span');
			inline.className = 'distill-inline-figure';
			const inlineImg = img.cloneNode(true) as HTMLImageElement;
			inline.appendChild(inlineImg);
			if (fig.caption) {
				const inlineCaption = document.createElement('span');
				inlineCaption.className = 'distill-inline-figure-caption';
				inlineCaption.textContent = fig.caption;
				inline.appendChild(inlineCaption);
			}
			fig.refElement.after(inline);
			this.inlineFigures.push(inline);
		}
	}

	clear(): void {
		for (const fig of this.figures) fig.remove();
		for (const inline of this.inlineFigures) inline.remove();
		this.figures = [];
		this.inlineFigures = [];
		this.registry.unregisterByType('figure');

		document.querySelectorAll('[data-distill-figure-rendered]').forEach(el => {
			el.removeAttribute('data-distill-figure-rendered');
		});
		document.querySelectorAll('[data-distill-figure-parsed]').forEach(el => {
			el.removeAttribute('data-distill-figure-parsed');
		});
	}

	destroy(): void {
		this.clear();
	}
}
