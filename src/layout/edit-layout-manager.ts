import type { DistillLayoutSettings } from '../types';

/**
 * Manages left/right column containers for edit mode (source + live preview).
 *
 * Containers are placed as children of `.markdown-source-view`, sitting
 * alongside `.cm-editor`.  The left column holds the TOC (no scroll-sync
 * needed — it's sticky).  The right column clips an inner "track" div
 * whose `transform: translateY(-scrollTop)` keeps sidenotes aligned with
 * the CM6 content as the user scrolls.
 */
export class EditLayoutManager {
	private settings: DistillLayoutSettings;
	private leftCol: HTMLElement | null = null;
	private rightCol: HTMLElement | null = null;
	private track: HTMLElement | null = null;
	private scrollHandler: (() => void) | null = null;
	private cmScroller: HTMLElement | null = null;
	private lastLayout: string | null = null;

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
		this.updateWidths();
	}

	/**
	 * Create (or reuse) the edit-mode column containers inside `.markdown-source-view`.
	 */
	ensureContainers(sourceView: HTMLElement, cmScroller: HTMLElement): {
		left: HTMLElement;
		right: HTMLElement;
		track: HTMLElement;
	} {
		// Already set up for this sourceView with the same layout
		const currentLayout = this.settings.columnLayout;
		if (
			this.leftCol?.isConnected &&
			this.rightCol?.isConnected &&
			this.leftCol.parentElement === sourceView &&
			this.lastLayout === currentLayout
		) {
			this.updateWidths();
			return { left: this.leftCol, right: this.rightCol, track: this.track! };
		}

		this.removeContainers();

		// Left column (TOC)
		const left = document.createElement('div');
		left.className = 'distill-edit-left-column';
		sourceView.appendChild(left);

		// Right column (sidenotes)
		const right = document.createElement('div');
		right.className = 'distill-edit-right-column';
		sourceView.appendChild(right);

		// Scroll-synced track — inside the column that holds sidenotes
		const track = document.createElement('div');
		track.className = 'distill-edit-sidenote-track';
		const trackParent = this.settings.columnLayout === 'swapped' ? left : right;
		trackParent.appendChild(track);

		sourceView.classList.add('distill-edit-active');

		this.leftCol = left;
		this.rightCol = right;
		this.track = track;
		this.lastLayout = this.settings.columnLayout;

		// Scroll sync — translate the track inversely to CM scroll
		this.cmScroller = cmScroller;
		this.scrollHandler = () => this.syncScroll();
		cmScroller.addEventListener('scroll', this.scrollHandler, { passive: true });

		this.updateWidths();

		return { left, right, track };
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

		if (this.leftCol) this.leftCol.style.width = `${leftWidth}px`;
		if (this.rightCol) this.rightCol.style.width = `${rightWidth}px`;
	}

	/**
	 * Translate the sidenote track to match the CM scroller's current scroll
	 * position, keeping sidenotes visually aligned with the editor content.
	 */
	syncScroll(): void {
		if (!this.track || !this.cmScroller) return;
		const scrollTop = this.cmScroller.scrollTop;
		this.track.style.transform = `translateY(${-scrollTop}px)`;
	}

	/**
	 * Set the track height to match the full CM content height so sidenotes
	 * can be positioned at any point along the document.
	 */
	syncTrackHeight(contentHeight: number): void {
		if (!this.track) return;
		this.track.style.height = `${contentHeight}px`;
	}

	removeContainers(): void {
		if (this.scrollHandler && this.cmScroller) {
			this.cmScroller.removeEventListener('scroll', this.scrollHandler);
			this.scrollHandler = null;
		}
		this.cmScroller = null;

		if (this.leftCol) {
			const parent = this.leftCol.parentElement;
			this.leftCol.remove();
			this.leftCol = null;
			// Remove the active class if we added it
			parent?.classList.remove('distill-edit-active');
		}
		if (this.rightCol) {
			this.rightCol.remove();
			this.rightCol = null;
		}
		this.track = null;
		this.lastLayout = null;
	}

	destroy(): void {
		this.removeContainers();
	}
}
