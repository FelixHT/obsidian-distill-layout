import type { App, MarkdownView } from 'obsidian';
import type { HeadingEntry, DistillLayoutSettings } from '../types';

/**
 * Extracts headings from metadataCache for edit-mode TOC.
 *
 * Unlike the preview-mode extractor that reads DOM elements from the
 * rendered HTML, this uses Obsidian's `metadataCache` for the heading
 * list (reliable even with CM6 virtualization) and CM6's `lineBlockAt()`
 * for pixel positions (works for off-screen lines).
 */
export function extractEditHeadings(
	app: App,
	view: MarkdownView,
	settings: DistillLayoutSettings
): HeadingEntry[] {
	const file = view.file;
	if (!file) return [];

	const cache = app.metadataCache.getFileCache(file);
	if (!cache?.headings) return [];

	// Access CM6 EditorView (Obsidian internal)
	const cmView = (view.editor as any).cm as import('@codemirror/view').EditorView | undefined;
	if (!cmView) return [];

	const headings: HeadingEntry[] = [];

	for (const heading of cache.headings) {
		if (heading.level > settings.tocMaxDepth) continue;

		// Get the CM6 document line for this heading
		const lineStart = heading.position.start.offset;
		let top = 0;

		try {
			const block = cmView.lineBlockAt(lineStart);
			top = block.top;
		} catch {
			// lineBlockAt can throw for invalid positions
			continue;
		}

		headings.push({
			id: `distill-edit-heading-${lineStart}`,
			text: heading.heading,
			level: heading.level,
			// In edit mode we don't have a rendered heading element;
			// store the cmContent as a fallback for any code that reads .element
			element: cmView.contentDOM,
			top,
			// Store the CM6 document offset for click-to-scroll
			linePos: lineStart,
		} as HeadingEntry & { linePos: number });
	}

	return headings;
}
