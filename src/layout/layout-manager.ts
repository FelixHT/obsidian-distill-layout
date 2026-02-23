import type { DistillLayoutSettings } from '../types';

/**
 * Manages left/right column containers for reading mode.
 *
 * Columns are children of `.workspace-leaf-content` (the NON-scrolling
 * ancestor of `.markdown-preview-view`), absolutely positioned in the
 * padding area.  Because they live outside the scroll container, they
 * are naturally viewport-fixed — no JS transforms needed on the columns.
 *
 * The right column clips an inner "track" div whose
 * `transform: translateY(-scrollTop)` keeps sidenotes aligned with the
 * content as the user scrolls (same pattern as EditLayoutManager).
 *
 * This requires ZERO overflow manipulation on the ancestor chain, so
 * Obsidian's virtual renderer works normally.
 */
export class LayoutManager {
	private settings: DistillLayoutSettings;
	private leftCol: HTMLElement | null = null;
	private rightCol: HTMLElement | null = null;
	private track: HTMLElement | null = null;
	private leftTrack: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private previewView: HTMLElement | null = null;
	private columnParent: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
	private sizerObserver: MutationObserver | null = null;
	private sizerEl: HTMLElement | null = null;
	private heightSyncTimer: ReturnType<typeof setTimeout> | null = null;
	private lastObservedWidth = 0;
	private lastLayout: string | null = null;
	private onResizeCallback?: () => void;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
		this.initResizeObserver();
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
		this.updateWidths();
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
			if (newWidth === this.lastObservedWidth) return;
			this.lastObservedWidth = newWidth;

			if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
			this.resizeTimeout = setTimeout(() => {
				this.onResizeCallback?.();
			}, 100);
		});
	}

	/**
	 * Ensure column containers exist for the given previewView.
	 * Columns are children of `.workspace-leaf-content` (non-scrolling);
	 * the track syncs with the scroll container's position.
	 *
	 * @param previewView  The `.markdown-preview-view` element (scroll container).
	 * @param previewSizer The `.markdown-preview-sizer` element (observed for resize).
	 */
	ensureContainers(previewView: HTMLElement, previewSizer: HTMLElement): {
		left: HTMLElement;
		right: HTMLElement;
		track: HTMLElement;
	} {
		const currentLayout = this.settings.columnLayout;
		const parent = previewView.closest('.workspace-leaf-content') as HTMLElement | null;
		if (
			this.leftCol?.isConnected &&
			this.rightCol?.isConnected &&
			this.leftCol.parentElement === (parent ?? previewView) &&
			this.lastLayout === currentLayout
		) {
			this.updateWidths();
			return { left: this.leftCol, right: this.rightCol, track: this.track! };
		}

		return this.createContainers(previewView, previewSizer);
	}

	private createContainers(previewView: HTMLElement, previewSizer: HTMLElement): {
		left: HTMLElement;
		right: HTMLElement;
		track: HTMLElement;
	} {
		this.removeContainers();

		// Columns live in the non-scrolling parent so they don't need
		// JS transforms to stay viewport-fixed (mirrors edit-mode approach).
		const colParent = previewView.closest('.workspace-leaf-content') as HTMLElement ?? previewView;
		this.columnParent = colParent;

		// Left column (TOC) — naturally fixed in the left padding
		const left = document.createElement('div');
		left.className = 'distill-left-column';
		colParent.appendChild(left);

		// Right column (sidenotes) — naturally fixed in the right padding
		const right = document.createElement('div');
		right.className = 'distill-right-column';
		colParent.appendChild(right);

		// Scroll-synced track — inside the column that holds sidenotes
		const track = document.createElement('div');
		track.className = 'distill-sidenote-track';
		const trackParent = this.settings.columnLayout === 'swapped' ? left : right;
		trackParent.appendChild(track);

		// Left track for alternating mode — mirrors the right track's scroll sync
		let leftTrack: HTMLElement | null = null;
		if (this.settings.columnLayout === 'alternating') {
			leftTrack = document.createElement('div');
			leftTrack.className = 'distill-sidenote-track distill-left-track';
			left.appendChild(leftTrack);
		}

		this.leftCol = left;
		this.rightCol = right;
		this.track = track;
		this.leftTrack = leftTrack;
		this.previewView = previewView;
		this.lastLayout = this.settings.columnLayout;

		// Scroll sync — translate track inversely to scroll
		this.scrollHandler = () => this.syncScroll();
		previewView.addEventListener('scroll', this.scrollHandler, { passive: true });

		// Observe sizer for width changes (triggers reposition)
		this.resizeObserver?.observe(previewSizer);

		// Observe sizer for child mutations (virtualizer adding/removing sections)
		this.sizerEl = previewSizer;
		this.sizerObserver = new MutationObserver(() => {
			if (this.heightSyncTimer) clearTimeout(this.heightSyncTimer);
			this.heightSyncTimer = setTimeout(() => {
				if (this.sizerEl) this.syncTrackHeight(this.sizerEl.scrollHeight);
			}, 50);
		});
		this.sizerObserver.observe(previewSizer, { childList: true });

		this.updateWidths();

		return { left, right, track };
	}

	private updateWidths(): void {
		const { tocWidth, sidenoteWidth, columnLayout } = this.settings;

		let leftWidth: number;
		let rightWidth: number;

		if (columnLayout === 'alternating') {
			leftWidth = sidenoteWidth;
			rightWidth = sidenoteWidth;
		} else if (columnLayout === 'swapped') {
			leftWidth = sidenoteWidth;
			rightWidth = tocWidth;
		} else {
			leftWidth = tocWidth;
			rightWidth = sidenoteWidth;
		}

		if (this.leftCol) {
			this.leftCol.style.width = `${leftWidth}px`;
		}
		if (this.rightCol) {
			this.rightCol.style.width = `${rightWidth}px`;
		}
	}

	/**
	 * Translate the sidenote track to match the scroll container's position,
	 * keeping sidenotes visually aligned with the main content.
	 *
	 * Columns are outside the scroll container (in .workspace-leaf-content)
	 * so they are naturally viewport-fixed — no column transforms needed.
	 * Only the track needs to counteract scrolling.
	 */
	syncScroll(): void {
		if (!this.track || !this.previewView) return;
		const st = this.previewView.scrollTop;
		this.track.style.transform = `translateY(${-st}px)`;
		if (this.leftTrack) this.leftTrack.style.transform = `translateY(${-st}px)`;
	}

	/**
	 * Set the track height to match the full sizer height so sidenotes
	 * can be positioned at any point along the document.
	 */
	syncTrackHeight(sizerHeight: number): void {
		if (!this.track) return;
		this.track.style.height = `${sizerHeight}px`;
		if (this.leftTrack) this.leftTrack.style.height = `${sizerHeight}px`;
	}

	getLeft(): HTMLElement | null {
		return this.leftCol;
	}

	getRight(): HTMLElement | null {
		return this.rightCol;
	}

	getTrack(): HTMLElement | null {
		return this.track;
	}

	getLeftTrack(): HTMLElement | null {
		return this.leftTrack;
	}

	getColumnParent(): HTMLElement | null {
		return this.columnParent;
	}

	removeContainers(): void {
		// Stop observing the old sizer to prevent spurious reposition calls
		this.resizeObserver?.disconnect();
		if (this.sizerObserver) { this.sizerObserver.disconnect(); this.sizerObserver = null; }
		if (this.heightSyncTimer) { clearTimeout(this.heightSyncTimer); this.heightSyncTimer = null; }
		this.sizerEl = null;
		if (this.scrollHandler && this.previewView) {
			this.previewView.removeEventListener('scroll', this.scrollHandler);
			this.scrollHandler = null;
		}
		this.previewView = null;
		this.columnParent = null;

		if (this.leftCol) {
			this.leftCol.remove();
			this.leftCol = null;
		}
		if (this.rightCol) {
			this.rightCol.remove();
			this.rightCol = null;
		}
		this.track = null;
		this.leftTrack = null;
		this.lastLayout = null;
	}

	destroy(): void {
		if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
		if (this.heightSyncTimer) clearTimeout(this.heightSyncTimer);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (this.sizerObserver) { this.sizerObserver.disconnect(); this.sizerObserver = null; }
		this.removeContainers();
	}
}
