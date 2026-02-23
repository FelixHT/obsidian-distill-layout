/**
 * Text-based figure parser for edit mode.
 * Finds `{>fig:![[imgName]]|caption}` patterns in raw document text.
 */

import { App, TFile } from 'obsidian';

export interface EditParsedFigure {
	id: string;
	refLine: number;
	refOffset: number;
	imgSrc: string;
	caption: string;
}

export function parseEditFigures(docText: string, app: App): EditParsedFigure[] {
	const results: EditParsedFigure[] = [];
	const regex = /\{>fig:!\[\[([^\]]+)\]\](?:\|([^}]*))?\}/g;
	let match;
	while ((match = regex.exec(docText)) !== null) {
		const offset = match.index;
		const line = docText.slice(0, offset).split('\n').length - 1;
		const imgName = match[1]!.trim();
		const caption = (match[2] ?? '').trim();

		// Resolve image via vault
		const file = app.metadataCache.getFirstLinkpathDest(imgName, '');
		if (!(file instanceof TFile)) continue;
		const imgSrc = app.vault.getResourcePath(file);

		let hash = 5381;
		for (let i = 0; i < (imgName + caption).length; i++) {
			hash = ((hash << 5) + hash + (imgName + caption).charCodeAt(i)) & 0xffffffff;
		}
		const id = `edit-figure-${(hash >>> 0).toString(36).padStart(6, '0').slice(0, 8)}`;

		results.push({ id, refLine: line, refOffset: offset, imgSrc, caption });
	}
	return results;
}
