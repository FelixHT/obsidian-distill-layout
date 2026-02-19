export interface ParsedComment {
	id: string;
	refElement: HTMLElement;
	content: string;
	author: string;
}

/**
 * Parses {?text} or {?author|text} margin comment syntax from the DOM.
 */
export class CommentParser {
	parse(container: HTMLElement): ParsedComment[] {
		const results: ParsedComment[] = [];

		// Phase A: recover existing markers
		const existingMarkers = container.querySelectorAll(
			'span.distill-comment-marker[data-comment-content]'
		);
		for (const marker of Array.from(existingMarkers)) {
			const htmlMarker = marker as HTMLElement;
			const content = htmlMarker.dataset.commentContent || '';
			const author = htmlMarker.dataset.commentAuthor || '';
			const id = htmlMarker.dataset.commentId || '';
			if (content && id) {
				results.push({ id, refElement: htmlMarker, content, author });
			}
		}

		// Phase B: walk text nodes for {?...} pattern
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
		const regex = /\{\?(?:([^|}]+)\|)?([^}]+)\}/g;

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
				const author = match[1]?.trim() || '';
				const content = match[2]!.trim();
				const index = currentText.lastIndexOf(fullMatch);
				if (index === -1) continue;

				const id = `comment-${this.hashContent(content + author)}`;

				const marker = document.createElement('span');
				marker.className = 'distill-comment-marker';
				marker.dataset.commentContent = content;
				marker.dataset.commentAuthor = author;
				marker.dataset.commentId = id;

				const before = currentText.slice(0, index);
				const after = currentText.slice(index + fullMatch.length);
				node.textContent = before;

				if (after) {
					parent.insertBefore(document.createTextNode(after), node.nextSibling);
				}
				parent.insertBefore(marker, node.nextSibling);

				results.push({ id, refElement: marker, content, author });
				currentText = before;
			}
		}

		return results;
	}

	private hashContent(content: string): string {
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
		}
		return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
	}
}
