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
	/** Track hidden source <pre> elements so we can restore them even if virtualized. */
	private hiddenSources: HTMLElement[] = [];
	/** Track rendered code IDs in memory — immune to Obsidian section virtualization. */
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
		parsedCodes: ParsedMarginCode[],
		sizerEl: HTMLElement,
		column: 'left' | 'right' = 'right'
	): void {
		const sizerRect = sizerEl.getBoundingClientRect();

		for (const parsed of parsedCodes) {
			if (this.renderedIds.has(parsed.id)) continue;
			this.renderedIds.add(parsed.id);

			// Track the hidden source element for reliable restoration
			this.hiddenSources.push(parsed.refElement);

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
		this.renderedIds.clear();
		this.registry.unregisterByType('code');

		// Restore hidden source elements via tracked references (works even if virtualized)
		for (const src of this.hiddenSources) {
			src.style.display = '';
			src.removeAttribute('data-distill-margin-code');
		}
		this.hiddenSources = [];

		// Best-effort DOM cleanup for any we missed
		document.querySelectorAll('[data-distill-margin-code]').forEach(el => {
			(el as HTMLElement).style.display = '';
			el.removeAttribute('data-distill-margin-code');
		});
	}

	destroy(): void {
		this.clear();
	}
}
