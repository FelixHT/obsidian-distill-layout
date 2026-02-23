import type { DistillLayoutSettings } from '../types';
import type { MarginItemRegistry } from './margin-item-registry';
import type { ParsedComment } from './comment-parser';

/**
 * Renders margin comments from parsed {?...} syntax.
 */
export class CommentRenderer {
	private settings: DistillLayoutSettings;
	private registry: MarginItemRegistry;
	private comments: HTMLElement[] = [];
	private inlineComments: HTMLElement[] = [];
	/** Track rendered comment IDs in memory — immune to Obsidian section virtualization. */
	private renderedIds = new Set<string>();

	constructor(settings: DistillLayoutSettings, registry: MarginItemRegistry) {
		this.settings = settings;
		this.registry = registry;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	render(
		container: HTMLElement,
		comments: ParsedComment[],
		sizerEl: HTMLElement,
		column: 'left' | 'right' = 'right'
	): void {
		const sizerRect = sizerEl.getBoundingClientRect();

		for (const comment of comments) {
			if (this.renderedIds.has(comment.id)) continue;
			this.renderedIds.add(comment.id);

			const commentEl = document.createElement('div');
			commentEl.className = 'distill-margin-comment';
			commentEl.dataset.commentId = comment.id;

			// Comment icon
			const iconSpan = document.createElement('span');
			iconSpan.className = 'distill-comment-icon';
			iconSpan.textContent = '\uD83D\uDCAC'; // 💬
			commentEl.appendChild(iconSpan);

			// Author label (optional)
			if (comment.author) {
				const authorSpan = document.createElement('span');
				authorSpan.className = 'distill-comment-author';
				authorSpan.textContent = comment.author;
				commentEl.appendChild(authorSpan);
			}

			// Content
			const contentSpan = document.createElement('span');
			contentSpan.className = 'distill-comment-content';
			contentSpan.textContent = comment.content;
			commentEl.appendChild(contentSpan);

			// Position
			const refRect = comment.refElement.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			commentEl.style.top = refTop;
			commentEl.dataset.refTop = refTop;

			container.appendChild(commentEl);
			this.comments.push(commentEl);

			// Register with registry
			this.registry.register({
				element: commentEl,
				refElement: comment.refElement,
				type: 'comment',
				id: comment.id,
				column,
			});

			// Inline fallback for narrow mode
			const inline = document.createElement('span');
			inline.className = 'distill-inline-comment';
			if (comment.author) {
				const inlineAuthor = document.createElement('strong');
				inlineAuthor.textContent = comment.author + ': ';
				inline.appendChild(inlineAuthor);
			}
			inline.appendChild(document.createTextNode(comment.content));
			comment.refElement.after(inline);
			this.inlineComments.push(inline);
		}
	}

	clear(): void {
		for (const c of this.comments) c.remove();
		for (const inline of this.inlineComments) inline.remove();
		this.comments = [];
		this.inlineComments = [];
		this.renderedIds.clear();
		this.registry.unregisterByType('comment');

		// Best-effort DOM cleanup (may miss virtualized sections)
		document.querySelectorAll('[data-distill-comment-rendered]').forEach(el => {
			el.removeAttribute('data-distill-comment-rendered');
		});
	}

	destroy(): void {
		this.clear();
	}
}
