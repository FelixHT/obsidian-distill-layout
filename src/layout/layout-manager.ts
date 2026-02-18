import type { DistillLayoutSettings, ColumnContainers } from '../types';

/**
 * Creates and manages left/right column containers inside .markdown-preview-sizer.
 * Containers are absolutely positioned outside the main content column.
 */
export class LayoutManager {
	private settings: DistillLayoutSettings;
	private containers: ColumnContainers = { left: null, right: null };
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
	private lastObservedWidth = 0;
	private onResizeCallback?: () => void;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
		this.initResizeObserver();
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
		this.updatePositions();
	}

	/** Register a callback that fires when the sizer width changes. */
	onResize(callback: () => void): void {
		this.onResizeCallback = callback;
	}

	private initResizeObserver(): void {
		this.resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const newWidth = entry.contentRect.width;
			if (newWidth === this.lastObservedWidth) return; // height-only change
			this.lastObservedWidth = newWidth;

			if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
			this.resizeTimeout = setTimeout(() => {
				this.onResizeCallback?.();
			}, 100);
		});
	}

	/**
	 * Ensure column containers exist inside the given previewSizer.
	 * If they already exist and are connected, just update positions.
	 */
	ensureContainers(previewSizer: HTMLElement): ColumnContainers {
		if (this.containers.left?.isConnected && this.containers.right?.isConnected
			&& this.containers.left.parentElement === previewSizer) {
			this.updatePositions();
			return this.containers;
		}
		return this.createContainers(previewSizer);
	}

	private createContainers(previewSizer: HTMLElement): ColumnContainers {
		// Clean up any stale containers
		this.removeContainers();

		const left = document.createElement('div');
		left.className = 'distill-left-column';
		previewSizer.appendChild(left);

		const right = document.createElement('div');
		right.className = 'distill-right-column';
		previewSizer.appendChild(right);

		this.containers = { left, right };

		// Observe sizer for height changes
		this.resizeObserver?.observe(previewSizer);
		this.updatePositions();

		return this.containers;
	}

	private updatePositions(): void {
		const { tocWidth, sidenoteWidth, gutterWidth, columnLayout } = this.settings;

		let leftWidth: number;
		let rightWidth: number;

		if (columnLayout === 'alternating') {
			// Both columns sized for sidenotes
			leftWidth = sidenoteWidth;
			rightWidth = sidenoteWidth;
		} else if (columnLayout === 'swapped') {
			leftWidth = sidenoteWidth;
			rightWidth = tocWidth;
		} else {
			leftWidth = tocWidth;
			rightWidth = sidenoteWidth;
		}

		if (this.containers.left) {
			this.containers.left.style.width = `${leftWidth}px`;
			this.containers.left.style.right = `calc(100% + ${gutterWidth}px)`;
		}
		if (this.containers.right) {
			this.containers.right.style.width = `${rightWidth}px`;
			this.containers.right.style.left = `calc(100% + ${gutterWidth}px)`;
		}
	}

	getLeft(): HTMLElement | null {
		return this.containers.left;
	}

	getRight(): HTMLElement | null {
		return this.containers.right;
	}

	removeContainers(): void {
		if (this.containers.left) {
			this.containers.left.remove();
			this.containers.left = null;
		}
		if (this.containers.right) {
			this.containers.right.remove();
			this.containers.right = null;
		}
	}

	destroy(): void {
		if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.removeContainers();
	}
}
