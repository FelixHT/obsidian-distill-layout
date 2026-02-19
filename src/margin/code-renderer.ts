import type { DistillLayoutSettings } from '../types';
import type { MarginItemRegistry } from './margin-item-registry';
import type { ParsedMarginCode } from './code-parser';

/**
 * Renders margin code blocks from parsed margin-* code blocks.
 */
export class CodeRenderer {
	private settings: DistillLayoutSettings;
	private registry: MarginItemRegistry;
	private codeBlocks: HTMLElement[] = [];

	constructor(settings: DistillLayoutSettings, registry: MarginItemRegistry) {
		this.settings = settings;
		this.registry = registry;
	}

	updateSettings(settings: DistillLayoutSettings): void {
		this.settings = settings;
	}

	render(
		container: HTMLElement,
		parsedCodes: ParsedMarginCode[],
		sizerEl: HTMLElement,
		column: 'left' | 'right' = 'right'
	): void {
		const sizerRect = sizerEl.getBoundingClientRect();

		for (const parsed of parsedCodes) {
			const wrapper = document.createElement('div');
			wrapper.className = 'distill-margin-code';
			wrapper.dataset.codeId = parsed.id;
			wrapper.dataset.language = parsed.language;

			// Apply max lines via max-height
			const lineHeight = 1.4; // em
			const fontSize = this.settings.sidenoteFontSize / 100; // relative
			const maxLines = this.settings.marginCodeMaxLines;
			wrapper.style.maxHeight = `${maxLines * lineHeight * fontSize}em`;
			wrapper.style.overflow = 'auto';

			wrapper.appendChild(parsed.codeElement);

			// Position
			const refRect = parsed.refElement.getBoundingClientRect();
			const refTop = `${refRect.top - sizerRect.top}px`;
			wrapper.style.top = refTop;
			wrapper.dataset.refTop = refTop;

			container.appendChild(wrapper);
			this.codeBlocks.push(wrapper);

			// Register with registry
			this.registry.register({
				element: wrapper,
				refElement: parsed.refElement,
				type: 'code',
				id: parsed.id,
				column,
			});
		}
	}

	clear(): void {
		for (const block of this.codeBlocks) block.remove();
		this.codeBlocks = [];
		this.registry.unregisterByType('code');

		// Restore hidden original code blocks
		document.querySelectorAll('[data-distill-margin-code]').forEach(el => {
			(el as HTMLElement).style.display = '';
			el.removeAttribute('data-distill-margin-code');
		});
	}

	destroy(): void {
		this.clear();
	}
}
