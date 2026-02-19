import { App, MarkdownView } from 'obsidian';

/**
 * Multi-pane TOC sync — when the active heading changes in one pane,
 * update the TOC highlight in other panes showing the same note.
 */
export class MultiPaneSync {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Sync TOC active state across panes showing the same file.
	 * Called as an additional callback alongside tocRenderer.setActive.
	 */
	syncActiveHeading(headingId: string): void {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.file) return;

		const activeFile = activeView.file;

		// Iterate all leaves to find other views of the same file
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf === activeView.leaf) return; // Skip the active leaf

			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			if (view.file !== activeFile) return;

			// Find the TOC in this leaf and set active
			const leafContent = view.containerEl.closest('.workspace-leaf-content') as HTMLElement;
			if (!leafContent) return;

			const tocItems = leafContent.querySelectorAll('.distill-toc-item');
			for (const item of Array.from(tocItems)) {
				const link = item.querySelector('.distill-toc-link') as HTMLElement;
				const itemHeadingId = link?.dataset.headingId;
				item.classList.toggle('distill-toc-active', itemHeadingId === headingId);
			}
		});
	}

	destroy(): void {
		// No persistent state to clean up
	}
}
