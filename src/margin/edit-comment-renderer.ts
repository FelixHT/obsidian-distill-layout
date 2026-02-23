import type { DistillLayoutSettings } from '../types';
import type { EditParsedComment } from './edit-comment-parser';

export class EditCommentRenderer {
	private settings: DistillLayoutSettings;
	private comments: HTMLElement[] = [];

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	render(
		track: HTMLElement,
		comments: EditParsedComment[],
		cmView: import('@codemirror/view').EditorView,
		contentOffset = 0
	): void {
		this.clear();
		const trackTop = track.getBoundingClientRect().top;
		for (const c of comments) {
			let top: number | null = null;
			const coords = cmView.coordsAtPos(c.refOffset);
			if (coords) {
				top = coords.top - trackTop;
			} else {
				try {
					top = cmView.lineBlockAt(c.refOffset).top + contentOffset;
				} catch { continue; }
			}

			const el = document.createElement('div');
			el.className = 'distill-margin-comment';
			el.dataset.commentId = c.id;

			const iconSpan = document.createElement('span');
			iconSpan.className = 'distill-comment-icon';
			iconSpan.textContent = '\uD83D\uDCAC';
			el.appendChild(iconSpan);

			if (c.author) {
				const authorSpan = document.createElement('span');
				authorSpan.className = 'distill-comment-author';
				authorSpan.textContent = c.author;
				el.appendChild(authorSpan);
			}

			const contentSpan = document.createElement('span');
			contentSpan.className = 'distill-comment-content';
			contentSpan.textContent = c.content;
			el.appendChild(contentSpan);

			el.style.position = 'absolute';
			el.style.top = `${top}px`;
			el.dataset.refTop = `${top}px`;
			el.dataset.refOffset = String(c.refOffset);

			track.appendChild(el);
			this.comments.push(el);
		}
	}

	getComments(): HTMLElement[] { return this.comments; }

	clear(): void {
		for (const c of this.comments) c.remove();
		this.comments = [];
	}

	destroy(): void { this.clear(); }
}
