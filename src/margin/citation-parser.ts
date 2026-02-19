import { App, TFile } from 'obsidian';

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

		// Phase A: recover existing markers
		const existingMarkers = container.querySelectorAll(
			'span.distill-citation-marker[data-cite-key]'
		);
		for (const marker of Array.from(existingMarkers)) {
			const htmlMarker = marker as HTMLElement;
			const citekey = htmlMarker.dataset.citeKey || '';
			const page = htmlMarker.dataset.citePage || '';
			const id = htmlMarker.dataset.citeId || '';
			if (citekey && id) {
				const bibEntry = this.bibEntries.get(citekey) || this.tryPluginLookup(citekey);
				results.push({ id, refElement: htmlMarker, citekey, page, bibEntry });
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
				const fullMatch = match[0]!;
				const citekey = match[1]!.trim();
				const page = match[2]?.trim() || '';
				const index = currentText.lastIndexOf(fullMatch);
				if (index === -1) continue;

				const id = `citation-${citekey}`;
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
			const citationPlugin = (this.app as any).plugins?.getPlugin?.('obsidian-citation-plugin');
			if (citationPlugin?.library?.data) {
				const entry = citationPlugin.library.data[citekey];
				if (entry) {
					return {
						key: citekey,
						type: entry.type || 'article',
						author: entry.author?.map((a: any) => `${a.given} ${a.family}`).join(' and ') || '',
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
	 * Simple BibTeX parser — extracts entries and their fields.
	 */
	private parseBibTeX(content: string): void {
		const entryRegex = /@(\w+)\s*\{([^,]+),([^@]*)\}/g;
		let match;

		while ((match = entryRegex.exec(content)) !== null) {
			const type = match[1]!.toLowerCase();
			const key = match[2]!.trim();
			const body = match[3]!;

			const entry: BibEntry = { key, type, author: '', title: '', year: '' };

			// Parse fields
			const fieldRegex = /(\w+)\s*=\s*[{"]([^}"]*)[}"]/g;
			let fieldMatch;
			while ((fieldMatch = fieldRegex.exec(body)) !== null) {
				const field = fieldMatch[1]!.toLowerCase();
				const value = fieldMatch[2]!.trim();
				entry[field] = value;
			}

			this.bibEntries.set(key, entry);
		}
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
