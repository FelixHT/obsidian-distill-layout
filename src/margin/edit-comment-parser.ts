/**
 * Text-based comment parser for edit mode.
 * Finds `{?text}` and `{?author|text}` patterns in raw document text.
 */

export interface EditParsedComment {
	id: string;
	refLine: number;
	refOffset: number;
	content: string;
	author: string;
}

export function parseEditComments(docText: string): EditParsedComment[] {
	const results: EditParsedComment[] = [];
	const regex = /\{\?(?:([^|}]+)\|)?([^}]+)\}/g;
	let match;
	while ((match = regex.exec(docText)) !== null) {
		const offset = match.index;
		const line = docText.slice(0, offset).split('\n').length - 1;
		const author = (match[1] ?? '').trim();
		const content = match[2]!.trim();
		let hash = 5381;
		for (let i = 0; i < (content + author).length; i++) {
			hash = ((hash << 5) + hash + (content + author).charCodeAt(i)) & 0xffffffff;
		}
		const id = `edit-comment-${(hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)}`;
		results.push({ id, refLine: line, refOffset: offset, content, author });
	}
	return results;
}
