import type { EditorView } from '@codemirror/view';
import type { DistillLayoutSettings } from '../types';
import type { EditParsedCode } from './edit-code-parser';

export class EditCodeRenderer {
	private settings: DistillLayoutSettings;
	private codeBlocks: HTMLElement[] = [];

	constructor(settings: DistillLayoutSettings) {
		this.settings = settings;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	render(
		track: HTMLElement,
		codes: EditParsedCode[],
		cmView: EditorView,
		contentOffset = 0
	): void {
		this.clear();
		const trackTop = track.getBoundingClientRect().top;
		for (const c of codes) {
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
			el.className = 'distill-margin-code';
			el.dataset.codeId = c.id;

			const pre = document.createElement('pre');
			const code = document.createElement('code');
			code.className = `language-${c.language}`;
			code.textContent = c.code;
			pre.appendChild(code);
			el.appendChild(pre);

			// Apply max-height based on settings
			const maxLines = this.settings.marginCodeMaxLines;
			if (maxLines > 0) {
				pre.style.setProperty('--distill-code-max-height', `${maxLines * 1.4}em`);
				pre.classList.add('distill-overflow-auto');
			}

			el.classList.add('distill-position-absolute');
			el.style.top = `${top}px`;
			el.dataset.refTop = `${top}px`;
			el.dataset.refOffset = String(c.refOffset);

			track.appendChild(el);
			this.codeBlocks.push(el);
		}
	}

	getCodeBlocks(): HTMLElement[] { return this.codeBlocks; }

	clear(): void {
		for (const el of this.codeBlocks) el.remove();
		this.codeBlocks = [];
	}

	destroy(): void { this.clear(); }
}
