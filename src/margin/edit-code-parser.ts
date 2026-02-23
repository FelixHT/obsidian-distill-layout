/**
 * Text-based code block parser for edit mode.
 * Finds fenced code blocks with `margin-*` language tags in raw document text.
 */

export interface EditParsedCode {
	id: string;
	refLine: number;
	refOffset: number;
	code: string;
	language: string;
}

export function parseEditCode(docText: string): EditParsedCode[] {
	const results: EditParsedCode[] = [];
	const regex = /^```margin-(\w+)\s*\n([\s\S]*?)^```/gm;
	let match;
	while ((match = regex.exec(docText)) !== null) {
		const offset = match.index;
		const line = docText.slice(0, offset).split('\n').length - 1;
		const language = match[1]!;
		const code = match[2]!;

		let hash = 5381;
		const key = language + code;
		for (let i = 0; i < key.length; i++) {
			hash = ((hash << 5) + hash + key.charCodeAt(i)) & 0xffffffff;
		}
		const id = `edit-code-${(hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)}`;

		results.push({ id, refLine: line, refOffset: offset, code, language });
	}
	return results;
}
