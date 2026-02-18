/**
 * Toggles a body class that activates CSS overflow:visible overrides
 * on Obsidian's container chain, allowing content to render in the margins.
 */
export class OverflowPatcher {
	private static readonly BODY_CLASS = 'distill-layout-active';

	enable(): void {
		document.body.classList.add(OverflowPatcher.BODY_CLASS);
	}

	disable(): void {
		document.body.classList.remove(OverflowPatcher.BODY_CLASS);
	}
}
