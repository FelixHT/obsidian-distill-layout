import type { HeadingEntry, DistillLayoutSettings } from '../types';

/**
 * Extracts heading entries from the rendered Reading View DOM.
 */
export function extractHeadings(
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

		// Skip headings inside collapsed sections
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
