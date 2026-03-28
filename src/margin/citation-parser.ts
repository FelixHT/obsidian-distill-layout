import { App, TFile } from 'obsidian';

/** Minimal shape of the obsidian-citation-plugin's exposed API. */
interface CitationPluginAuthor { given: string; family: string }
interface CitationPluginEntry {
	type?: string;
	author?: CitationPluginAuthor[];
	title?: string;
	issued?: { 'date-parts'?: number[][] };
}
interface CitationPluginApi {
	library?: { data?: Record<string, CitationPluginEntry> };
}
interface AppWithPlugins {
	plugins?: { getPlugin?: (id: string) => CitationPluginApi | undefined };
}

export interface BibEntry {
	key: string;
	type: string;
	author: string;
	title: string;
	year: string;
	[field: string]: string;
}

export interface ParsedCitation {
	id: string;
	refElement: HTMLElement;
	citekey: string;
	page: string;
	bibEntry: BibEntry | null;
}

/**
 * Parses [@citekey] and [@key, p. 42] citation syntax from the DOM.
 * Loads and caches BibTeX entries from a configured .bib file.
 */
export class CitationParser {
	private app: App;
	private bibEntries: Map<string, BibEntry> = new Map();
	private bibLoaded = false;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Load the BibTeX file from the configured path.
	 */
	async loadBibFile(bibPath: string): Promise<void> {
		if (!bibPath) return;

		this.bibEntries.clear();
		this.bibLoaded = false;

		const file = this.app.vault.getAbstractFileByPath(bibPath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		this.parseBibTeX(content);
		this.bibLoaded = true;
	}

	parse(container: HTMLElement): ParsedCitation[] {
		const results: ParsedCitation[] = [];
		const citeCounts = new Map<string, number>();

		// Phase A: recover existing markers
		const existingMarkers = container.querySelectorAll<HTMLElement>(
			'span.distill-citation-marker[data-cite-key]'
		);
		for (const marker of Array.from(existingMarkers)) {
			const citekey = marker.dataset.citeKey || '';
			const page = marker.dataset.citePage || '';
			const id = marker.dataset.citeId || '';
			if (citekey && id) {
				const bibEntry = this.bibEntries.get(citekey) || this.tryPluginLookup(citekey);
				results.push({ id, refElement: marker, citekey, page, bibEntry });
			}
		}

		// Phase B: walk text nodes for [@citekey] patterns
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
		const regex = /\[@([^\],]+)(?:,\s*([^\]]*))?\]/g;

		const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = [];

		let node;
		while ((node = walker.nextNode())) {
			const text = node.textContent || '';
			const matches: RegExpMatchArray[] = [];
			let match;
			regex.lastIndex = 0;
			while ((match = regex.exec(text)) !== null) {
				matches.push([...match] as RegExpMatchArray);
			}
			if (matches.length > 0) {
				nodesToProcess.push({ node: node as Text, matches });
			}
		}

		for (const { node, matches } of nodesToProcess.reverse()) {
			const parent = node.parentElement;
			if (!parent) continue;
			let currentText = node.textContent || '';

			for (const match of matches.reverse()) {
				const fullMatch = match[0];
				const citekey = match[1]!.trim();
				const page = match[2]?.trim() || '';
				const index = currentText.lastIndexOf(fullMatch);
				if (index === -1) continue;

				const baseKey = `citation-${citekey}${page ? '-' + page.replace(/\s+/g, '') : ''}`;
				const count = citeCounts.get(baseKey) || 0;
				citeCounts.set(baseKey, count + 1);
				const id = `${baseKey}-${count}`;
				const bibEntry = this.bibEntries.get(citekey) || this.tryPluginLookup(citekey);

				const marker = document.createElement('span');
				marker.className = 'distill-citation-marker';
				marker.dataset.citeKey = citekey;
				marker.dataset.citePage = page;
				marker.dataset.citeId = id;

				// Show inline citation text
				if (bibEntry) {
					const authorLastName = bibEntry.author.split(',')[0]?.split(' and ')[0]?.trim() || citekey;
					marker.textContent = page
						? `(${authorLastName}, ${bibEntry.year}, ${page})`
						: `(${authorLastName}, ${bibEntry.year})`;
				} else {
					marker.textContent = page ? `[${citekey}, ${page}]` : `[${citekey}]`;
				}

				const before = currentText.slice(0, index);
				const after = currentText.slice(index + fullMatch.length);
				node.textContent = before;

				if (after) {
					parent.insertBefore(document.createTextNode(after), node.nextSibling);
				}
				parent.insertBefore(marker, node.nextSibling);

				results.push({ id, refElement: marker, citekey, page, bibEntry });
				currentText = before;
			}
		}

		return results;
	}

	/**
	 * Try to look up via obsidian-citation-plugin if installed.
	 */
	private tryPluginLookup(citekey: string): BibEntry | null {
		try {
			const citationPlugin = (this.app as unknown as AppWithPlugins).plugins?.getPlugin?.('obsidian-citation-plugin');
			if (citationPlugin?.library?.data) {
				const entry = citationPlugin.library.data[citekey];
				if (entry) {
					return {
						key: citekey,
						type: entry.type || 'article',
						author: entry.author?.map((a: CitationPluginAuthor) => `${a.given} ${a.family}`).join(' and ') || '',
						title: entry.title || '',
						year: entry.issued?.['date-parts']?.[0]?.[0]?.toString() || '',
					};
				}
			}
		} catch {
			// Plugin not available
		}
		return null;
	}

	/**
	 * BibTeX parser — uses brace-counting to handle nested braces
	 * and `@` characters inside URLs / field values.
	 */
	private parseBibTeX(content: string): void {
		// Split on `@` that starts an entry type keyword
		const chunks = content.split(/(?=@\w+\s*\{)/);

		for (const chunk of chunks) {
			const headerMatch = chunk.match(/^@(\w+)\s*\{/);
			if (!headerMatch) continue;

			// Count braces to find the true end of the entry
			let depth = 0;
			let entryEnd = -1;
			const startIdx = chunk.indexOf('{');
			for (let i = startIdx; i < chunk.length; i++) {
				if (chunk[i] === '{') depth++;
				else if (chunk[i] === '}') depth--;
				if (depth === 0) {
					entryEnd = i;
					break;
				}
			}
			if (entryEnd === -1) continue;

			const type = headerMatch[1]!.toLowerCase();
			const inner = chunk.slice(startIdx + 1, entryEnd);

			// The key is everything up to the first comma
			const commaIdx = inner.indexOf(',');
			if (commaIdx === -1) continue;
			const key = inner.slice(0, commaIdx).trim();
			const body = inner.slice(commaIdx + 1);

			const entry: BibEntry = { key, type, author: '', title: '', year: '' };

			// Parse fields — handle nested braces in values
			const fieldRegex = /(\w+)\s*=\s*/g;
			let fieldMatch;
			while ((fieldMatch = fieldRegex.exec(body)) !== null) {
				const field = fieldMatch[1]!.toLowerCase();
				const valueStart = fieldMatch.index + fieldMatch[0].length;
				const extracted = this.extractBibValue(body, valueStart);
				if (extracted !== null) {
					entry[field] = extracted.value.trim();
					// Advance regex past the consumed value to prevent re-scanning
					fieldRegex.lastIndex = extracted.endIndex + 1;
				}
			}

			this.bibEntries.set(key, entry);
		}
	}

	/**
	 * Extract a BibTeX field value starting at the given position.
	 * Returns the value and the index of the closing delimiter.
	 */
	private extractBibValue(body: string, start: number): { value: string; endIndex: number } | null {
		const ch = body[start];
		if (ch === '{') {
			let depth = 0;
			for (let i = start; i < body.length; i++) {
				if (body[i] === '{') depth++;
				else if (body[i] === '}') depth--;
				if (depth === 0) return { value: body.slice(start + 1, i), endIndex: i };
			}
		} else if (ch === '"') {
			// Handle escaped quotes inside double-quoted values
			for (let i = start + 1; i < body.length; i++) {
				if (body[i] === '\\' && i + 1 < body.length) { i++; continue; }
				if (body[i] === '"') return { value: body.slice(start + 1, i), endIndex: i };
			}
		} else {
			// Bare value (e.g. a number): read until comma or end
			const end = body.indexOf(',', start);
			const endIdx = end !== -1 ? end : body.length;
			return { value: body.slice(start, endIdx).trim(), endIndex: endIdx };
		}
		return null;
	}

	/**
	 * Format a citation for display in the margin.
	 */
	formatCitation(entry: BibEntry, style: 'author-year' | 'numbered', index?: number): string {
		if (style === 'numbered' && index != null) {
			return `[${index}] ${entry.author}. "${entry.title}." ${entry.year}.`;
		}
		return `${entry.author} (${entry.year}). \u201C${entry.title}.\u201D`;
	}

	destroy(): void {
		this.bibEntries.clear();
		this.bibLoaded = false;
	}
}
