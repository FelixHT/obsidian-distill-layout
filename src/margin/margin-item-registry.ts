import type { MarginItem } from '../types';

/**
 * Unified registry for all margin items (sidenotes, figures, code, comments,
 * citations, Dataview). Collects items per column, sorts by document order,
 * and runs a single collision pass to prevent overlapping.
 */
export class MarginItemRegistry {
	private items: MarginItem[] = [];

	register(item: MarginItem): void {
		this.items.push(item);
	}

	unregisterByType(type: string): void {
		this.items = this.items.filter(item => item.type !== type);
	}

	unregisterById(id: string): void {
		this.items = this.items.filter(item => item.id !== id);
	}

	/**
	 * Update the ref element for an existing item (used when upgrading
	 * pre-created sidenotes from placeholder to real DOM ref).
	 */
	updateRefElement(id: string, newRef: HTMLElement): void {
		const item = this.items.find(i => i.id === id);
		if (item) item.refElement = newRef;
	}

	clear(): void {
		this.items = [];
	}

	/**
	 * Run collision resolution on all registered items, per column.
	 * Sorts by document order then pushes overlapping items downward.
	 */
	resolveAll(gap = 8): void {
		const left = this.items.filter(i => i.column === 'left');
		const right = this.items.filter(i => i.column === 'right');

		this.sortByDocumentOrder(left);
		this.sortByDocumentOrder(right);

		this.resolveColumn(left, gap);
		this.resolveColumn(right, gap);
	}

	/**
	 * Recalculate refTop for all items from current DOM, then resolve.
	 */
	repositionAll(sizerEl: HTMLElement, gap = 8): void {
		const sizerRect = sizerEl.getBoundingClientRect();
		for (const item of this.items) {
			if (!item.refElement.isConnected) continue;
			const refRect = item.refElement.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			item.element.style.top = refTop;
			item.element.dataset.refTop = refTop;
		}
		this.resolveAll(gap);
	}

	getItems(): MarginItem[] {
		return this.items;
	}

	destroy(): void {
		this.clear();
	}

	private sortByDocumentOrder(items: MarginItem[]): void {
		items.sort((a, b) => {
			// Pre-created items may have detached placeholder refs —
			// fall back to refTop comparison when either ref is disconnected.
			const aConnected = a.refElement.isConnected;
			const bConnected = b.refElement.isConnected;
			if (!aConnected || !bConnected) {
				const aTop = parseFloat(a.element.dataset.refTop || '0');
				const bTop = parseFloat(b.element.dataset.refTop || '0');
				return aTop - bTop;
			}
			const pos = a.refElement.compareDocumentPosition(b.refElement);
			if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
			if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
			return 0;
		});
	}

	private resolveColumn(items: MarginItem[], gap: number): void {
		if (items.length < 2) return;

		// Reset each item to its reference-aligned position
		for (const item of items) {
			if (item.element.dataset.refTop) {
				item.element.style.top = item.element.dataset.refTop;
			}
		}

		// Push overlapping items downward
		for (let i = 1; i < items.length; i++) {
			const prev = items[i - 1]!;
			const curr = items[i]!;
			const prevBottom = parseFloat(prev.element.style.top) + (prev.element.getBoundingClientRect().height || prev.element.offsetHeight);
			const currTop = parseFloat(curr.element.style.top);
			if (currTop < prevBottom + gap) {
				curr.element.style.top = `${prevBottom + gap}px`;
			}
		}
	}
}
