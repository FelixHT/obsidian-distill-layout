import type { DistillLayoutSettings } from '../types';
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
	/** Track rendered figure IDs in memory — immune to Obsidian section virtualization. */
	private renderedIds = new Set<string>();
	private cleared = false;

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
		this.cleared = false;
		const sizerRect = sizerEl.getBoundingClientRect();

		for (const fig of figures) {
			if (this.renderedIds.has(fig.id)) {
				const existing = this.figures.find(f => f.dataset.figureId === fig.id);
				if (existing?.isConnected) continue;
				// Stale entry — clean up and fall through to re-render
				this.renderedIds.delete(fig.id);
				this.figures = this.figures.filter(f => f !== existing);
				this.inlineFigures = this.inlineFigures.filter(f => {
					// Remove inline fallback associated with this figure
					if (f.previousElementSibling?.classList.contains('distill-figure-marker') &&
						(f.previousElementSibling as HTMLElement)?.dataset?.figureId === fig.id) {
						f.remove();
						return false;
					}
					return true;
				});
				this.registry.unregisterById(fig.id);
			}
			this.renderedIds.add(fig.id);

			const figureEl = document.createElement('figure');
			figureEl.className = 'distill-margin-figure';
			figureEl.dataset.figureId = fig.id;

			const img = document.createElement('img');
			img.src = fig.imgSrc;
			img.alt = fig.caption || '';
			img.style.setProperty('--distill-figure-max-height', `${this.settings.marginFigureMaxHeight}px`);
			img.addEventListener('load', () => {
				if (this.cleared) return;
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
		this.cleared = true;
		for (const fig of this.figures) fig.remove();
		for (const inline of this.inlineFigures) inline.remove();
		this.figures = [];
		this.inlineFigures = [];
		this.renderedIds.clear();
		this.registry.unregisterByType('figure');

		// Best-effort DOM cleanup (may miss virtualized sections)
		document.querySelectorAll('[data-distill-figure-rendered]').forEach(el => {
			el.removeAttribute('data-distill-figure-rendered');
		});
		document.querySelectorAll('[data-distill-figure-parsed]').forEach(el => {
			(el as HTMLElement).classList.remove('distill-hidden');
			el.removeAttribute('data-distill-figure-parsed');
		});
	}

	destroy(): void {
		this.clear();
	}
}
