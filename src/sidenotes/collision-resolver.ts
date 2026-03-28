/**
 * Resolves vertical overlap between sidenote elements by
 * pushing overlapping notes downward.
 *
 * The input array must be in document order (the caller is responsible
 * for sorting via compareDocumentPosition before calling this function).
 */
export function resolveCollisions(notes: HTMLElement[], gap = 8): void {
	if (notes.length < 2) return;

	// Reset each note to its original reference-aligned position.
	for (const note of notes) {
		if (note.dataset.refTop) {
			note.style.top = note.dataset.refTop;
		}
	}

	// Push overlapping notes downward, processing in document order.
	for (let i = 1; i < notes.length; i++) {
		const prev = notes[i - 1]!;
		const curr = notes[i]!;

		const prevBottom = parseFloat(prev.style.top) + (prev.getBoundingClientRect().height || prev.offsetHeight);
		const currTop = parseFloat(curr.style.top);

		if (currTop < prevBottom + gap) {
			curr.style.top = `${prevBottom + gap}px`;
		}
	}
}
