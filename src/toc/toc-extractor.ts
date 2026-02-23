import type { App, MarkdownView } from 'obsidian';
import type { HeadingEntry, DistillLayoutSettings } from '../types';

/**
 * Extracts headings using Obsidian's metadataCache (complete even when
 * the virtual renderer hasn't rendered all sections).  DOM elements are
 * linked when available; virtualized headings get estimated positions.
 *
 * Falls back to pure-DOM extraction when no cache is available.
 */
export function extractHeadings(
	previewSizer: HTMLElement,
	settings: DistillLayoutSettings,
	app: App,
	view: MarkdownView
): HeadingEntry[] {
	const file = view.file;
	if (!file) return extractHeadingsFromDOM(previewSizer, settings);

	const cache = app.metadataCache.getFileCache(file);
	if (!cache?.headings) return extractHeadingsFromDOM(previewSizer, settings);

	const domMap = buildDomHeadingMap(previewSizer, settings.tocMaxDepth);
	const sizerRect = previewSizer.getBoundingClientRect();
	const totalLines = view.data.split('\n').length || 1;
	const headings: HeadingEntry[] = [];

	for (const cached of cache.headings) {
		if (cached.level > settings.tocMaxDepth) continue;

		const text = cached.heading.trim();
		if (!text) continue;

		const line = cached.position.start.line;

		// Link to DOM element if available (consume in order for duplicates)
		const domList = domMap.get(text);
		const element = domList?.shift() ?? null;

		let top: number;
		if (element) {
			top = element.getBoundingClientRect().top - sizerRect.top;
		} else {
			// Estimate position proportionally for virtualized headings
			top = (line / totalLines) * previewSizer.scrollHeight;
		}

		headings.push({
			id: `distill-heading-${line}`,
			text,
			level: cached.level,
			element: element ?? previewSizer,
			top,
			line,
		});
	}

	return headings;
}

/** Pure-DOM fallback when metadataCache is unavailable. */
function extractHeadingsFromDOM(
	previewSizer: HTMLElement,
	settings: DistillLayoutSettings
): HeadingEntry[] {
	const selector = Array.from(
		{ length: settings.tocMaxDepth },
		(_, i) => `h${i + 1}`
	).join(', ');

	const elements = previewSizer.querySelectorAll(selector);
	const sizerRect = previewSizer.getBoundingClientRect();
	const headings: HeadingEntry[] = [];

	elements.forEach((el, index) => {
		const heading = el as HTMLElement;
		if (heading.closest('.is-collapsed')) return;

		const level = parseInt(heading.tagName[1]!);
		const text = heading.textContent?.trim() || '';
		if (!text) return;

		headings.push({
			id: `distill-heading-${index}`,
			text,
			level,
			element: heading,
			top: heading.getBoundingClientRect().top - sizerRect.top,
		});
	});

	return headings;
}

/** Build Map<text, HTMLElement[]> of heading elements currently in the DOM. */
function buildDomHeadingMap(
	previewSizer: HTMLElement,
	maxDepth: number
): Map<string, HTMLElement[]> {
	const selector = Array.from(
		{ length: maxDepth },
		(_, i) => `h${i + 1}`
	).join(', ');

	const elements = previewSizer.querySelectorAll(selector);
	const map = new Map<string, HTMLElement[]>();

	for (const el of Array.from(elements)) {
		const heading = el as HTMLElement;
		if (heading.closest('.is-collapsed')) continue;

		const text = heading.textContent?.trim() || '';
		if (!text) continue;

		if (!map.has(text)) map.set(text, []);
		map.get(text)!.push(heading);
	}

	return map;
}
