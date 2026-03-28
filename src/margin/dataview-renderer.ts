import type { MarginItemRegistry } from './margin-item-registry';
import type { ParsedDataview } from './dataview-parser';

/**
 * Renders Dataview results in the margin column.
 */
export class DataviewRenderer {
	private registry: MarginItemRegistry;
	private elements: HTMLElement[] = [];

	constructor(registry: MarginItemRegistry) {
		this.registry = registry;
	}

	render(
		container: HTMLElement,
		parsedItems: ParsedDataview[],
		sizerEl: HTMLElement,
		column: 'left' | 'right' = 'right'
	): void {
		const sizerRect = sizerEl.getBoundingClientRect();

		for (const item of parsedItems) {
			if (!item.renderedContent) continue;
			if (item.refElement.dataset.distillDataviewRendered) continue;
			item.refElement.dataset.distillDataviewRendered = 'true';

			const wrapper = document.createElement('div');
			wrapper.className = 'distill-margin-dataview';
			wrapper.dataset.dataviewId = item.id;

			wrapper.appendChild(item.renderedContent);

			// Position
			const refRect = item.refElement.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			wrapper.style.top = refTop;
			wrapper.dataset.refTop = refTop;

			container.appendChild(wrapper);
			this.elements.push(wrapper);

			// Register with registry
			this.registry.register({
				element: wrapper,
				refElement: item.refElement,
				type: 'dataview',
				id: item.id,
				column,
			});
		}
	}

	clear(): void {
		for (const el of this.elements) el.remove();
		this.elements = [];
		this.registry.unregisterByType('dataview');

		document.querySelectorAll('[data-distill-dataview-margin]').forEach(el => {
			(el as HTMLElement).classList.remove('distill-hidden');
			el.removeAttribute('data-distill-dataview-margin');
		});
		document.querySelectorAll('[data-distill-dataview-rendered]').forEach(el => {
			el.removeAttribute('data-distill-dataview-rendered');
		});
	}

	destroy(): void {
		this.clear();
	}
}
