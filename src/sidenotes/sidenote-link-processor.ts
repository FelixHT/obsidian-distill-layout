import { App } from 'obsidian';

/**
 * Processes wikilinks inside rendered sidenotes, making them clickable
 * and optionally showing backlink indicators.
 */
export class SidenoteLinkProcessor {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Process links in a sidenote element.
	 * @param sidenoteEl  The rendered sidenote element.
	 * @param sourcePath  The path of the current file (for link resolution).
	 * @param showBacklinks  Whether to show backlink indicators.
	 */
	process(sidenoteEl: HTMLElement, sourcePath: string, showBacklinks: boolean): void {
		const links = sidenoteEl.querySelectorAll('a.internal-link');

		for (const link of Array.from(links)) {
			const anchor = link as HTMLAnchorElement;
			const href = anchor.getAttribute('href') || anchor.dataset.href || '';
			if (!href) continue;

			// Add click handler to open the linked note
			anchor.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.app.workspace.openLinkText(href, sourcePath);
			});

			// Backlink indicator
			if (showBacklinks) {
				const linkedFile = this.app.metadataCache.getFirstLinkpathDest(href, sourcePath);
				if (linkedFile) {
					const backlinks = (this.app.metadataCache as any).getBacklinksForFile?.(linkedFile);
					if (backlinks?.data && backlinks.data.has(sourcePath)) {
						const indicator = document.createElement('span');
						indicator.className = 'distill-backlink-indicator';
						indicator.title = 'Linked note links back to this note';
						indicator.textContent = '\u21C4'; // ⇄
						anchor.after(indicator);
					}
				}
			}
		}
	}
}
