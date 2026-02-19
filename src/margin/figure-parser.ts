import { App, TFile } from 'obsidian';

export interface ParsedFigure {
	id: string;
	refElement: HTMLElement;
	imgSrc: string;
	caption: string;
}

/**
 * Parses {>fig:![[img]]|caption} syntax from the rendered DOM.
 *
 * Obsidian converts ![[img]] into <span class="internal-embed"> elements
 * before the plugin runs, so we can't regex-match the raw syntax in text
 * nodes. Instead we find embed elements and check their adjacent text
 * nodes for the {>fig: prefix and |caption} suffix.
 */
export class FigureParser {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	parse(container: HTMLElement): ParsedFigure[] {
		const results: ParsedFigure[] = [];

		// Phase A: recover existing markers from a previous parse
		const existingMarkers = container.querySelectorAll(
			'span.distill-figure-marker[data-figure-src]'
		);
		for (const marker of Array.from(existingMarkers)) {
			const htmlMarker = marker as HTMLElement;
			const src = htmlMarker.dataset.figureSrc || '';
			const caption = htmlMarker.dataset.figureCaption || '';
			const id = htmlMarker.dataset.figureId || '';
			if (src && id) {
				results.push({ id, refElement: htmlMarker, imgSrc: src, caption });
			}
		}

		// Phase B: find Obsidian embed elements preceded by {>fig: text
		const embeds = container.querySelectorAll('.internal-embed');
		for (const embed of Array.from(embeds)) {
			// Already processed?
			if ((embed as HTMLElement).dataset.distillFigureParsed) continue;

			// Check previous text node for {>fig: prefix
			const prevText = this.findAdjacentText(embed, 'before');
			if (!prevText) continue;

			const prefixMatch = prevText.textContent?.match(/\{>fig:$/);
			if (!prefixMatch) continue;

			// Check next text node for |caption} or just }
			const nextText = this.findAdjacentText(embed, 'after');
			if (!nextText) continue;

			const suffixMatch = nextText.textContent?.match(/^(?:\|([^}]*))?\}/);
			if (!suffixMatch) continue;

			const caption = suffixMatch[1]?.trim() || '';

			// Extract image source from the embed
			const imgSrc = this.resolveEmbedSrc(embed as HTMLElement);
			if (!imgSrc) continue;

			const imgName = embed.getAttribute('src') || '';
			const id = `figure-${this.hashContent(imgName + caption)}`;

			// Create marker span to replace the {>fig: embed |caption} sequence
			const marker = document.createElement('span');
			marker.className = 'distill-figure-marker';
			marker.dataset.figureSrc = imgSrc;
			marker.dataset.figureCaption = caption;
			marker.dataset.figureId = id;
			(embed as HTMLElement).dataset.distillFigureParsed = 'true';

			// Clean up: remove {>fig: from preceding text
			const prevContent = prevText.textContent || '';
			prevText.textContent = prevContent.slice(0, prevContent.length - '{>fig:'.length);

			// Clean up: remove |caption} or } from following text
			const nextContent = nextText.textContent || '';
			nextText.textContent = nextContent.slice(suffixMatch[0].length);

			// Insert marker after the embed
			embed.parentNode?.insertBefore(marker, embed.nextSibling);

			results.push({ id, refElement: marker, imgSrc, caption });
		}

		// Phase C (fallback): walk text nodes for raw syntax (e.g. source mode
		// or cases where Obsidian didn't process the embed)
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
		const regex = /\{>fig:!\[\[([^\]]+)\]\](?:\|([^}]*))?\}/g;

		const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

		let node;
		while ((node = walker.nextNode())) {
			const text = node.textContent || '';
			const matches: RegExpMatchArray[] = [];
			let match;
			regex.lastIndex = 0;
			while ((match = regex.exec(text)) !== null) {
				matches.push([...match] as RegExpMatchArray);
			}
			if (matches.length > 0) {
				nodesToProcess.push({ node: node as Text, matches });
			}
		}

		for (const { node, matches } of nodesToProcess.reverse()) {
			const parent = node.parentElement;
			if (!parent) continue;
			let currentText = node.textContent || '';

			for (const match of matches.reverse()) {
				const fullMatch = match[0]!;
				const imgName = match[1]!.trim();
				const caption = (match[2] ?? '').trim();
				const index = currentText.lastIndexOf(fullMatch);
				if (index === -1) continue;

				// Resolve image path
				const imgSrc = this.resolveImagePath(imgName);
				if (!imgSrc) continue;

				const id = `figure-${this.hashContent(imgName + caption)}`;

				const marker = document.createElement('span');
				marker.className = 'distill-figure-marker';
				marker.dataset.figureSrc = imgSrc;
				marker.dataset.figureCaption = caption;
				marker.dataset.figureId = id;

				const before = currentText.slice(0, index);
				const after = currentText.slice(index + fullMatch.length);
				node.textContent = before;

				if (after) {
					parent.insertBefore(document.createTextNode(after), node.nextSibling);
				}
				parent.insertBefore(marker, node.nextSibling);

				results.push({ id, refElement: marker, imgSrc, caption });
				currentText = before;
			}
		}

		return results;
	}

	/**
	 * Find the adjacent text node before or after an element.
	 * Walks through siblings to find the nearest text node.
	 */
	private findAdjacentText(el: Element, direction: 'before' | 'after'): Text | null {
		const sibling = direction === 'before' ? el.previousSibling : el.nextSibling;
		if (sibling?.nodeType === Node.TEXT_NODE) {
			return sibling as Text;
		}
		return null;
	}

	/**
	 * Extract the resolved image source from an Obsidian embed element.
	 * Tries the child <img> first (loaded embed), then falls back to
	 * resolving the embed's src attribute via the vault.
	 */
	private resolveEmbedSrc(embed: HTMLElement): string | null {
		// Try child <img> element (loaded embed)
		const img = embed.querySelector('img');
		if (img?.src) return img.src;

		// Fall back to resolving via vault metadata
		const srcAttr = embed.getAttribute('src') || '';
		if (srcAttr) return this.resolveImagePath(srcAttr);

		return null;
	}

	private resolveImagePath(imgName: string): string | null {
		const file = this.app.metadataCache.getFirstLinkpathDest(imgName, '');
		if (file instanceof TFile) {
			return this.app.vault.getResourcePath(file);
		}
		return null;
	}

	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
		}
		return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
	}
}
