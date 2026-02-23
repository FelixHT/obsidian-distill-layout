/**
 * Text-based footnote parser for edit mode.
 *
 * Works on the raw document text (identical in source mode and live
 * preview) instead of rendered DOM. Finds `[^id]: content` definitions
 * and `[^id]` references, plus `{>text}` custom sidenote syntax.
 */

export interface EditParsedFootnote {
	id: string;
	/** 0-indexed line number of the [^id] reference */
	refLine: number;
	/** Character offset of the reference in the document */
	refOffset: number;
	/** Footnote definition text */
	content: string;
	type: 'sidenote' | 'marginnote';
	/** Icon name for icon sidenotes (e.g. 'warning' from {>!warning: text}) */
	icon?: string;
}

export function parseEditFootnotes(docText: string, customSyntax: boolean): EditParsedFootnote[] {
	const definitions = parseDefinitions(docText);
	const refs = parseReferences(docText);
	const results: EditParsedFootnote[] = [];

	// Match refs to definitions
	for (const ref of refs) {
		const def = definitions.get(ref.id);
		if (def) {
			results.push({
				id: ref.id,
				refLine: ref.line,
				refOffset: ref.offset,
				content: def,
				type: 'sidenote',
			});
		}
	}

	// Parse {>text} custom syntax
	if (customSyntax) {
		const customNotes = parseCustomSyntax(docText);
		results.push(...customNotes);
	}

	// Sort by document position (offset)
	results.sort((a, b) => a.refOffset - b.refOffset);

	return results;
}

/**
 * Find `[^id]: content` definitions, including multi-line continuations
 * (indented lines following the definition).
 */
export function parseDefinitions(docText: string): Map<string, string> {
	const defs = new Map<string, string>();
	const lines = docText.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i]!.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
		if (!match) continue;

		const id = match[1]!;
		const parts = [match[2]!.trim()];

		// Collect indented continuation lines
		while (i + 1 < lines.length) {
			const nextLine = lines[i + 1]!;
			// Continuation: starts with tab or 2+ spaces (and is not another definition)
			if (/^(?:\t|  +)\S/.test(nextLine) && !/^\[\^/.test(nextLine.trim())) {
				parts.push(nextLine.trim());
				i++;
			} else {
				break;
			}
		}

		defs.set(id, parts.join(' '));
	}

	return defs;
}

/**
 * Find `[^id]` references (NOT followed by `:`, which would be definitions).
 * Returns line number and character offset for each.
 */
function parseReferences(docText: string): Array<{ id: string; line: number; offset: number }> {
	const refs: Array<{ id: string; line: number; offset: number }> = [];
	const regex = /\[\^([^\]]+)\](?!:)/g;
	let match;

	while ((match = regex.exec(docText)) !== null) {
		const offset = match.index;
		// Count lines up to this offset
		const line = docText.slice(0, offset).split('\n').length - 1;

		// Skip references that are inside a definition line (e.g. footnote body referencing another)
		const lineStart = docText.lastIndexOf('\n', offset - 1) + 1;
		const lineText = docText.slice(lineStart, docText.indexOf('\n', offset));
		if (/^\[\^[^\]]+\]:/.test(lineText)) continue;

		refs.push({ id: match[1]!, line, offset });
	}

	return refs;
}

/**
 * Find `{>text}`, `{>id|text}`, and `{>!icon: text}` custom sidenote patterns.
 */
function parseCustomSyntax(docText: string): EditParsedFootnote[] {
	const results: EditParsedFootnote[] = [];
	const regex = /\{>(?!fig:)(?:!(\w+):\s*)?(?:([^:|]+)\|)?([^}]+)\}/g;
	let match;

	while ((match = regex.exec(docText)) !== null) {
		const offset = match.index;
		const line = docText.slice(0, offset).split('\n').length - 1;
		const content = match[3]!.trim();

		// Generate a deterministic ID from content
		let hash = 5381;
		for (let i = 0; i < content.length; i++) {
			hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
		}
		const id = `edit-custom-${(hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)}`;

		results.push({
			id,
			refLine: line,
			refOffset: offset,
			content,
			type: 'marginnote',
			icon: match[1] || undefined,
		});
	}

	return results;
}
