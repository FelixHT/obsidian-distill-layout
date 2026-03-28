import { MarkdownView, Plugin } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { DEFAULT_SETTINGS, DistillLayoutSettings, HeadingEntry } from './types';
import { DistillLayoutSettingTab, applyCSSVariables, removeCSSVariables } from './settings';
import { LayoutManager } from './layout/layout-manager';
import { EditLayoutManager } from './layout/edit-layout-manager';
import { ResponsiveManager } from './layout/responsive-manager';
import { extractHeadings } from './toc/toc-extractor';
import { extractEditHeadings } from './toc/edit-toc-extractor';
import { TocRenderer } from './toc/toc-renderer';
import { TocTracker } from './toc/toc-tracker';
import { EditTocTracker } from './toc/edit-toc-tracker';
import { ProgressBar } from './toc/progress-bar';
import { ReadingTime } from './toc/reading-time';
import { TocTooltip } from './toc/toc-tooltip';
import { MultiPaneSync } from './toc/multi-pane-sync';
import { FootnoteParser } from './sidenotes/footnote-parser';
import { SidenoteRenderer } from './sidenotes/sidenote-renderer';
import { SidenoteAnimator } from './sidenotes/sidenote-animator';
import { SidenoteLinkProcessor } from './sidenotes/sidenote-link-processor';
import { parseEditFootnotes } from './sidenotes/edit-footnote-parser';
import { EditSidenoteRenderer } from './sidenotes/edit-sidenote-renderer';
import { resolveCollisions } from './sidenotes/collision-resolver';
import { parseEditComments } from './margin/edit-comment-parser';
import { EditCommentRenderer } from './margin/edit-comment-renderer';
import { parseEditCode } from './margin/edit-code-parser';
import { EditCodeRenderer } from './margin/edit-code-renderer';
import { parseEditFigures, EditParsedFigure } from './margin/edit-figure-parser';
import { EditFigureRenderer } from './margin/edit-figure-renderer';
import { MarginItemRegistry } from './margin/margin-item-registry';
import { FigureParser } from './margin/figure-parser';
import { FigureRenderer } from './margin/figure-renderer';
import { CodeParser } from './margin/code-parser';
import { CodeRenderer } from './margin/code-renderer';
import { CommentParser } from './margin/comment-parser';
import { CommentRenderer } from './margin/comment-renderer';
import { CitationParser } from './margin/citation-parser';
import { CitationRenderer } from './margin/citation-renderer';
import { DataviewParser } from './margin/dataview-parser';
import { DataviewRenderer } from './margin/dataview-renderer';

type DistillViewMode = 'preview' | 'source' | 'live-preview';

function detectViewMode(view: MarkdownView): DistillViewMode {
	if (view.getMode() === 'preview') return 'preview';
	const sv = view.containerEl.querySelector('.markdown-source-view');
	return sv?.classList.contains('is-live-preview') ? 'live-preview' : 'source';
}

export default class DistillLayoutPlugin extends Plugin {
	settings: DistillLayoutSettings = DEFAULT_SETTINGS;

	private static readonly BODY_CLASS = 'distill-layout-active';
	private layout!: LayoutManager;
	private editLayout!: EditLayoutManager;
	private responsive!: ResponsiveManager;
	private tocRenderer!: TocRenderer;
	private tocTracker!: TocTracker;
	private editTocTracker!: EditTocTracker;
	private progressBar!: ProgressBar;
	private readingTime!: ReadingTime;
	private tocTooltip!: TocTooltip;
	private multiPaneSync!: MultiPaneSync;
	private footnoteParser!: FootnoteParser;
	private sidenoteRenderer!: SidenoteRenderer;
	private sidenoteAnimator!: SidenoteAnimator;
	private sidenoteLinkProcessor!: SidenoteLinkProcessor;
	private editSidenoteRenderer!: EditSidenoteRenderer;
	private editCommentRenderer!: EditCommentRenderer;
	private editCodeRenderer!: EditCodeRenderer;
	private editFigureRenderer!: EditFigureRenderer;
	private registry!: MarginItemRegistry;
	private figureParser!: FigureParser;
	private figureRenderer!: FigureRenderer;
	private codeParser!: CodeParser;
	private codeRenderer!: CodeRenderer;
	private commentParser!: CommentParser;
	private commentRenderer!: CommentRenderer;
	private citationParser!: CitationParser;
	private citationRenderer!: CitationRenderer;
	private dataviewParser!: DataviewParser;
	private dataviewRenderer!: DataviewRenderer;

	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private refreshId = 0;
	private sectionGenId = 0;
	private repositionTimer: ReturnType<typeof setTimeout> | null = null;
	private editScrollCleanup: (() => void) | null = null;
	private repositionId = 0;
	private deferredSections: HTMLElement[] = [];
	private sectionObserverCleanup: (() => void) | null = null;
	private sweepIntervalId: ReturnType<typeof setInterval> | null = null;
	private unloaded = false;

	/** Track last mode to detect mode switches → full refresh */
	private lastViewMode: DistillViewMode | null = null;
	/** Cached heading entries for incremental relinking when sections render */
	private cachedHeadings: HeadingEntry[] | null = null;
	/** Source text cached during doPreviewRefresh — available for processSection even if
	 *  the active view changes (e.g. multi-pane setups). */
	private cachedSourceText: string | undefined;

	async onload(): Promise<void> {
		await this.loadSettings();

		// ── Phase 0: Shared Infrastructure ──
		this.registry = new MarginItemRegistry();

		// Instantiate subsystems
		this.layout = new LayoutManager(this.settings);
		this.layout.onResize(() => this.debouncedReposition());
		this.editLayout = new EditLayoutManager(this.settings);
		this.responsive = new ResponsiveManager(this.settings);
		this.tocRenderer = new TocRenderer(this.settings);
		this.tocTracker = new TocTracker(
			(id) => {
				this.tocRenderer.setActive(id);
				// Multi-pane sync
				if (this.settings.multiPaneSyncEnabled) {
					this.multiPaneSync.syncActiveHeading(id);
				}
			},
		);
		this.editTocTracker = new EditTocTracker(
			(id) => this.tocRenderer.setActive(id),
		);

		// Phase 1: Reading experience
		this.progressBar = new ProgressBar();
		this.readingTime = new ReadingTime();
		this.tocTooltip = new TocTooltip();
		this.multiPaneSync = new MultiPaneSync(this.app);
		this.sidenoteAnimator = new SidenoteAnimator(this.settings);
		this.sidenoteLinkProcessor = new SidenoteLinkProcessor(this.app);

		// Sidenotes
		this.footnoteParser = new FootnoteParser(this.settings, this.app);
		this.sidenoteRenderer = new SidenoteRenderer(this.settings, this.registry, this.app);
		this.editSidenoteRenderer = new EditSidenoteRenderer(this.settings);
		this.editCommentRenderer = new EditCommentRenderer(this.settings);
		this.editCodeRenderer = new EditCodeRenderer(this.settings);
		this.editFigureRenderer = new EditFigureRenderer(this.settings);

		// Phase 2: Margin content types
		this.figureParser = new FigureParser(this.app);
		this.figureRenderer = new FigureRenderer(this.settings, this.registry);
		this.codeParser = new CodeParser();
		this.codeRenderer = new CodeRenderer(this.settings, this.registry);
		this.commentParser = new CommentParser();
		this.commentRenderer = new CommentRenderer(this.settings, this.registry);
		this.citationParser = new CitationParser(this.app);
		this.citationRenderer = new CitationRenderer(this.settings, this.registry, this.citationParser);
		this.dataviewParser = new DataviewParser();
		this.dataviewRenderer = new DataviewRenderer(this.registry);

		// Load bibliography if configured
		if (this.settings.citationsEnabled && this.settings.citationBibPath) {
			void this.citationParser.loadBibFile(this.settings.citationBibPath);
		}

		// Enable body class for CSS scoping + CSS variables
		document.body.classList.add(DistillLayoutPlugin.BODY_CLASS);
		applyCSSVariables(this.settings);
		this.applyLayoutBodyClass();

		// Settings tab
		this.addSettingTab(new DistillLayoutSettingTab(this.app, this));

		// Post-processor for margin content (runs per-section in reading view).
		// Registered unconditionally so settings toggles take effect without reload.
		this.registerMarkdownPostProcessor((el, ctx) => {
			const gen = this.refreshId;
			// Double-rAF to wait for DOM layout
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (this.unloaded) return;
					if (gen !== this.refreshId) {
						if (el.isConnected && this.deferredSections.length < 200) {
							this.deferredSections.push(el);
						}
						return;
					}
					this.processSection(el);
				});
			});
		});

		// Workspace events for TOC + full layout
		this.registerEvent(
			this.app.workspace.on('file-open', () => this.debouncedRefresh())
		);
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.debouncedReposition())
		);
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.debouncedReposition())
		);

		// metadataCache change → refresh edit mode when headings/content change
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (!this.settings.enableInEditMode) return;
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || view.file !== file) return;
				const mode = detectViewMode(view);
				if (mode === 'source' || mode === 'live-preview') {
					this.debouncedRefresh();
				}
			})
		);

		// Window resize — catches resizes missed by the LayoutManager's
		// ResizeObserver (e.g. when the sizer is max-width-limited)
		this.registerDomEvent(window, 'resize', () => this.debouncedReposition());

		// Commands
		this.addCommand({
			id: 'toggle-toc',
			name: 'Toggle TOC',
			callback: () => {
				this.settings.tocEnabled = !this.settings.tocEnabled;
				void this.saveSettings();
				this.refresh();
			},
		});

		this.addCommand({
			id: 'toggle-sidenotes',
			name: 'Toggle sidenotes',
			callback: () => {
				this.settings.sidenotesEnabled = !this.settings.sidenotesEnabled;
				void this.saveSettings();
				this.refresh();
			},
		});

		// Initial render after workspace is ready
		this.app.workspace.onLayoutReady(() => this.refresh());
	}

	onunload(): void {
		this.unloaded = true;
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		if (this.repositionTimer) clearTimeout(this.repositionTimer);
		this.teardown();
		this.teardownEdit();
		document.body.classList.remove(DistillLayoutPlugin.BODY_CLASS);
		removeCSSVariables();
		document.body.classList.remove('distill-layout-swapped');
		document.body.classList.remove('distill-layout-alternating');
		this.layout.destroy();
		this.editLayout.destroy();
		this.responsive.destroy();
		this.tocRenderer.destroy();
		this.tocTracker.destroy();
		this.editTocTracker.destroy();
		this.progressBar.destroy();
		this.readingTime.destroy();
		this.tocTooltip.destroy();
		this.multiPaneSync.destroy();
		this.footnoteParser.destroy();
		this.sidenoteRenderer.destroy();
		this.sidenoteAnimator.destroy();
		this.editSidenoteRenderer.destroy();
		this.editCommentRenderer.destroy();
		this.editCodeRenderer.destroy();
		this.editFigureRenderer.destroy();
		this.registry.destroy();
		this.figureRenderer.destroy();
		this.codeRenderer.destroy();
		this.commentRenderer.destroy();
		this.citationRenderer.destroy();
		this.citationParser.destroy();
		this.dataviewParser.destroy();
		this.dataviewRenderer.destroy();

		// Clean up any data attributes we set on heading elements
		document.querySelectorAll('[data-distill-heading-id]').forEach(el => {
			el.removeAttribute('data-distill-heading-id');
		});

		// Clean up edit-active class
		document.querySelectorAll('.distill-edit-active').forEach(el => {
			el.classList.remove('distill-edit-active');
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		applyCSSVariables(this.settings);
		this.applyLayoutBodyClass();
		this.layout.updateSettings(this.settings);
		this.editLayout.updateSettings(this.settings);
		this.responsive.updateSettings(this.settings);
		this.tocRenderer.updateSettings(this.settings);
		this.footnoteParser.updateSettings(this.settings);
		this.sidenoteRenderer.updateSettings(this.settings);
		this.sidenoteAnimator.updateSettings(this.settings);
		this.figureRenderer.updateSettings(this.settings);
		this.codeRenderer.updateSettings(this.settings);
		this.commentRenderer.updateSettings(this.settings);
		this.citationRenderer.updateSettings(this.settings);
		this.editSidenoteRenderer.updateSettings(this.settings);
		this.editCommentRenderer.updateSettings(this.settings);
		this.editCodeRenderer.updateSettings(this.settings);
		this.editFigureRenderer.updateSettings(this.settings);

		// Reload bibliography if path changed
		if (this.settings.citationsEnabled && this.settings.citationBibPath) {
			void this.citationParser.loadBibFile(this.settings.citationBibPath);
		}

		// Re-render so layout/column changes take effect immediately
		this.debouncedRefresh();
	}

	private applyLayoutBodyClass(): void {
		const layout = this.settings.columnLayout;
		document.body.classList.toggle('distill-layout-swapped', layout === 'swapped');
		document.body.classList.toggle('distill-layout-alternating', layout === 'alternating');
	}

	// ── Core logic ──────────────────────────────────────

	private debouncedRefresh(): void {
		// Cancel any pending reposition — refresh is a superset
		if (this.repositionTimer) { clearTimeout(this.repositionTimer); this.repositionTimer = null; }
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		++this.refreshId;  // invalidate any pending processSection rAF callbacks
		this.debounceTimer = setTimeout(() => this.refresh(), 150);
	}

	private refresh(): void {
		const id = ++this.refreshId;

		// Double-rAF ensures the reading view DOM is fully rendered
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (this.unloaded) return;
				// Null debounceTimer inside the rAF so debouncedReposition()
				// correctly detects a pending refresh during the async window.
				this.debounceTimer = null;
				if (id !== this.refreshId) return; // stale, skip
				this.doRefresh();
			});
		});
	}

	private doRefresh(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const currentMode = detectViewMode(view);

		// Detect mode switch → tear down the other mode's content
		if (this.lastViewMode && this.lastViewMode !== currentMode) {
			if (this.lastViewMode === 'preview') {
				this.teardown();
			} else {
				this.teardownEdit();
			}
		}
		this.lastViewMode = currentMode;

		if (currentMode === 'preview') {
			this.doPreviewRefresh(view);
		} else if (this.settings.enableInEditMode) {
			this.doEditRefresh(view, currentMode);
		} else {
			this.teardownEdit();
		}
	}

	/** Preview (reading) mode refresh — the original doRefresh logic. */
	private doPreviewRefresh(view: MarkdownView): void {
		const leafContent = view.containerEl.closest('.workspace-leaf-content') as HTMLElement;
		if (!leafContent) return;

		const previewView = leafContent.querySelector('.markdown-preview-view') as HTMLElement;
		if (!previewView) return;

		const previewSizer = previewView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!previewSizer) return;

		// Cache source text for processSection (avoids reliance on getActiveViewOfType
		// which can return null in multi-pane setups or when focus shifts)
		this.cachedSourceText = view.data;

		// Clear old content before rebuilding (containers stay)
		this.clearContent();

		// Snapshot the current refreshId as the generation for section stamping.
		// Must be set AFTER clearContent() so rAF callbacks from the old generation
		// don't stamp sections with the new gen before old stamps are cleared.
		this.sectionGenId = this.refreshId;

		// Create/reuse column containers (children of previewView, with scroll-synced track)
		const { left, right, track } = this.layout.ensureContainers(previewView, previewSizer);

		// Responsive mode detection
		this.responsive.observe(leafContent);

		// Determine which container gets TOC vs sidenotes based on layout
		const layout = this.settings.columnLayout;
		const isAlternating = layout === 'alternating';
		const swapped = layout === 'swapped';
		const tocContainer = isAlternating ? null : (swapped ? right : left);
		// Sidenotes render into the track (scroll-synced), not the column itself
		const sidenoteTrack = track;
		// For alternating mode, use the scroll-synced left track (not the raw column)
		const altTrack = isAlternating ? this.layout.getLeftTrack() ?? undefined : undefined;

		// ── TOC (disabled in alternating mode) ──
		if (this.settings.tocEnabled && tocContainer) {
			const headings = extractHeadings(previewSizer, this.settings, this.app, view);
			this.cachedHeadings = headings;
			this.tocRenderer.render(tocContainer, headings, undefined, view);

			// .markdown-preview-view IS the scroll container
			const scrollContainer = previewView;
			this.tocTracker.observe(headings, scrollContainer);

			// ── Progress Bar ──
			if (this.settings.progressBarEnabled) {
				this.progressBar.render(tocContainer, scrollContainer);
			}

			// ── Reading Time ──
			if (this.settings.readingTimeEnabled) {
				this.readingTime.render(tocContainer, view.data, this.settings.wordsPerMinute);
			}

			// ── TOC Section Previews ──
			if (this.settings.tocPreviewsEnabled) {
				this.tocTooltip.attach(tocContainer, previewSizer, this.settings.tocPreviewMaxChars);
			}
		}

		// ── Pre-create ALL sidenotes from source text ──
		if (this.settings.sidenotesEnabled && this.cachedSourceText) {
			const totalLines = this.cachedSourceText.split('\n').length || 1;
			const editFootnotes = parseEditFootnotes(
				this.cachedSourceText,
				this.settings.customSidenoteSyntax
			);
			if (editFootnotes.length > 0) {
				this.sidenoteRenderer.preRender(
					sidenoteTrack,
					editFootnotes,
					previewSizer.scrollHeight,
					totalLines,
					altTrack,
					this.cachedSourceText
				);
			}
		}

		// Collect sections that actually had content parsed during the full-document pass.
		// Only these should be stamped as "processed" — placeholder sections with
		// wrapper divs but no actual content must remain unstamped.
		const processedSections = new Set<HTMLElement>();

		// ── Margin Figures (must run before sidenotes — figure parser mutates DOM) ──
		if (this.settings.marginFiguresEnabled) {
			try {
				const figures = this.figureParser.parse(previewView);
				if (figures.length > 0) {
					this.figureRenderer.render(sidenoteTrack, figures, previewSizer);
					for (const fig of figures) {
						const section = fig.refElement.closest('.markdown-preview-section') as HTMLElement;
						if (section) processedSections.add(section);
					}
				}
			} catch (e) {
				console.error('Distill Layout: figure parsing failed', e);
			}
		}

		// ── Sidenotes (full-document pass) ──
		if (this.settings.sidenotesEnabled) {
			const currentRefreshId = this.refreshId;
			// Capture file path now — view.file may change by the time the callback fires
			const filePath = view.file?.path;

			const footnotes = this.footnoteParser.parseFullDocument(previewView, (lateFootnotes) => {
				if (currentRefreshId !== this.refreshId) return;
				this.sidenoteRenderer.render(sidenoteTrack, lateFootnotes, previewSizer, altTrack);
				if (this.settings.sidenoteLinksEnabled && filePath) {
					for (const el of Array.from(sidenoteTrack.querySelectorAll<HTMLElement>('.distill-sidenote'))) {
						this.sidenoteLinkProcessor.process(el, filePath, this.settings.sidenoteBacklinks);
					}
				}
				this.registry.resolveAll();
				this.layout.syncTrackHeight(previewSizer.scrollHeight);
			}, view.data);

			const customNotes = this.footnoteParser.parseCustomSyntax(previewView);
			const all = [...footnotes, ...customNotes].sort((a, b) => {
				const pos = a.refElement.compareDocumentPosition(b.refElement);
				if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
				if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
				return 0;
			});
			if (all.length > 0) {
				this.sidenoteRenderer.render(sidenoteTrack, all, previewSizer, altTrack);

				if (this.settings.sidenoteLinksEnabled && view.file) {
					const sidenoteEls = sidenoteTrack.querySelectorAll<HTMLElement>('.distill-sidenote');
					for (const el of Array.from(sidenoteEls)) {
						this.sidenoteLinkProcessor.process(
							el,
							view.file.path,
							this.settings.sidenoteBacklinks
						);
					}
				}

				// Track which sections had sidenote refs
				for (const item of all) {
					const section = item.refElement.closest('.markdown-preview-section') as HTMLElement;
					if (section) processedSections.add(section);
				}
			}
		}

		// ── Phase 2: New Margin Content Types ──

		// Margin Code
		if (this.settings.marginCodeEnabled) {
			try {
				const codes = this.codeParser.parse(previewView);
				if (codes.length > 0) {
					this.codeRenderer.render(sidenoteTrack, codes, previewSizer);
					for (const c of codes) {
						const section = c.refElement.closest('.markdown-preview-section') as HTMLElement;
						if (section) processedSections.add(section);
					}
				}
			} catch (e) {
				console.error('Distill Layout: code parsing failed', e);
			}
		}

		// Margin Comments
		if (this.settings.marginCommentsEnabled) {
			try {
				const comments = this.commentParser.parse(previewView);
				if (comments.length > 0) {
					this.commentRenderer.render(sidenoteTrack, comments, previewSizer);
					for (const c of comments) {
						const section = c.refElement.closest('.markdown-preview-section') as HTMLElement;
						if (section) processedSections.add(section);
					}
				}
			} catch (e) {
				console.error('Distill Layout: comment parsing failed', e);
			}
		}

		// Citations
		if (this.settings.citationsEnabled) {
			try {
				const citations = this.citationParser.parse(previewView);
				if (citations.length > 0) {
					this.citationRenderer.render(sidenoteTrack, citations, previewSizer);
					for (const c of citations) {
						const section = c.refElement.closest('.markdown-preview-section') as HTMLElement;
						if (section) processedSections.add(section);
					}
				}
			} catch (e) {
				console.error('Distill Layout: citation parsing failed', e);
			}
		}

		// Dataview
		if (this.settings.dataviewMarginEnabled) {
			try {
				const dataviews = this.dataviewParser.parse(previewView, (parsed) => {
					this.dataviewRenderer.render(sidenoteTrack, [parsed], previewSizer);
					this.registry.resolveAll();
					this.layout.syncTrackHeight(previewSizer.scrollHeight);
				});
				if (dataviews.length > 0) {
					this.dataviewRenderer.render(sidenoteTrack, dataviews, previewSizer);
					for (const dv of dataviews) {
						const section = dv.refElement.closest('.markdown-preview-section') as HTMLElement;
						if (section) processedSections.add(section);
					}
				}
			} catch (e) {
				console.error('Distill Layout: dataview parsing failed', e);
			}
		}

		// ── Unified Collision Resolution (Phase 0) ──
		this.registry.resolveAll();

		// Sync track height to match full document height
		this.layout.syncTrackHeight(previewSizer.scrollHeight);

		// Stamp only sections that actually had content parsed during the full-document pass.
		// Sections without any parsed refs/content must remain unstamped so processSection()
		// can handle them when their content is populated by the virtualizer on scroll.
		// Safety: renderedIds in SidenoteRenderer.render() prevents double-rendering even if
		// processSection() re-runs on an already-handled section.
		for (const section of processedSections) {
			section.dataset.distillProcessedGen = String(this.sectionGenId);
		}
		// Watch for virtualizer adding new sections (scrolling brings off-screen content into view)
		this.setupSectionObserver(previewSizer);

		// Persistent polling sweep: catch sections populated by the virtualizer
		// at any time (e.g. when scrolling back to the top after a mode switch).
		// Runs every 500ms until the next full refresh invalidates sectionGenId.
		if (this.sweepIntervalId) { clearInterval(this.sweepIntervalId); this.sweepIntervalId = null; }
		const sweepGenId = this.sectionGenId;
		const sweepId = setInterval(() => {
			if (this.sectionGenId !== sweepGenId) {
				clearInterval(sweepId);
				// Only null the field if it still points to this interval
				if (this.sweepIntervalId === sweepId) this.sweepIntervalId = null;
				return;
			}
			const allSections = previewSizer.querySelectorAll('.markdown-preview-section');
			for (const s of Array.from(allSections)) {
				const section = s as HTMLElement;
				if (section.dataset.distillProcessedGen === String(this.sectionGenId)) continue;
				if (section.childElementCount > 0 || (section.textContent ?? '').trim().length > 0) {
					this.processSection(section);
				}
			}
		}, 500);
		this.sweepIntervalId = sweepId;

		// Process sections whose post-processor callbacks were deferred during refresh
		if (this.deferredSections.length > 0) {
			const deferred = this.deferredSections;
			this.deferredSections = [];
			for (const el of deferred) {
				if (el.isConnected) this.processSection(el);
			}
		}

		// Initial scroll sync
		this.layout.syncScroll();

		// ── Inline fallbacks for pre-created sidenotes ──
		// Pre-created sidenotes skip render() (ID already in renderedIds) and
		// never get inline fallbacks. Create them now that DOM markers exist.
		if (this.settings.sidenotesEnabled) {
			this.sidenoteRenderer.ensureInlineFallbacks(previewSizer);
		}

		// ── Sidenote Animations (Phase 1) ──
		if (this.settings.sidenoteAnimations) {
			this.sidenoteAnimator.observe(sidenoteTrack);
		}

		// (Delayed initial rescan removed — pre-creation handles off-screen sidenotes.
		// Strategies 1-3 + sweep handle position upgrades as sections render.)
	}

	/** Edit (source / live-preview) mode refresh. */
	private doEditRefresh(view: MarkdownView, viewMode: DistillViewMode): void {
		const leafContent = view.containerEl.closest('.workspace-leaf-content') as HTMLElement;
		if (!leafContent) return;

		const sourceView = leafContent.querySelector('.markdown-source-view') as HTMLElement;
		if (!sourceView) return;

		const cmEditor = sourceView.querySelector('.cm-editor') as HTMLElement;
		if (!cmEditor) return;

		const cmScroller = cmEditor.querySelector('.cm-scroller') as HTMLElement;
		if (!cmScroller) return;

		// Access CM6 EditorView (Obsidian internal)
		const cmView = (view.editor as unknown as { cm?: EditorView }).cm;
		if (!cmView) return;

		// Clear previous edit content
		this.clearEditContent();

		// Create/reuse edit-mode column containers
		const { left, right, track } = this.editLayout.ensureContainers(sourceView, cmScroller);

		// Responsive mode detection for edit mode
		this.responsive.observeEdit(leafContent, sourceView);

		// ── TOC ──
		const layout = this.settings.columnLayout;
		const isAlternating = layout === 'alternating';
		const tocContainer = isAlternating ? null : (layout === 'swapped' ? right : left);

		if (this.settings.tocEnabled && tocContainer) {
			const headings = extractEditHeadings(this.app, view, this.settings);

			// Click callback: use CM6-native scrolling
			const onItemClick = (heading: HeadingEntry) => {
				if (heading.linePos != null) {
					cmView.dispatch({
						effects: EditorView.scrollIntoView(heading.linePos, { y: 'start' }),
					});
				}
			};

			this.tocRenderer.render(tocContainer, headings, onItemClick);

			// Scroll-based active heading tracking
			this.editTocTracker.observe(headings, cmScroller);
		}

		// ── Sync scroll first so track transform matches current scroll position ──
		this.editLayout.syncScroll();

		// ── Compute contentOffset for CM6 → track coordinate mapping ──
		// lineBlockAt().top is in CM6 document coordinates (from top of cm-content).
		// The track is transformed by -scrollTop, mirroring the scroller.
		// contentOffset = structural gap from track origin to cm-content origin.
		// Both rects are shifted by the same scrollTop, so their difference is constant.
		const cmContent = cmEditor.querySelector('.cm-content') as HTMLElement;
		const contentOffset = cmContent
			? cmContent.getBoundingClientRect().top - track.getBoundingClientRect().top
			: 0;

		const docText = cmView.state.doc.toString();

		// ── Sidenotes ──
		if (this.settings.sidenotesEnabled) {
			const footnotes = parseEditFootnotes(docText, this.settings.customSidenoteSyntax);

			if (footnotes.length > 0) {
				this.editSidenoteRenderer.render(track, footnotes, cmView, contentOffset);
			}
		}

		// ── Margin Comments ──
		if (this.settings.marginCommentsEnabled) {
			const comments = parseEditComments(docText);
			if (comments.length > 0) {
				this.editCommentRenderer.render(track, comments, cmView, contentOffset);
			}
		}

		// ── Margin Figures ──
		if (this.settings.marginFiguresEnabled) {
			const figures = parseEditFigures(docText, this.app);
			const displayMode = this.settings.editFigureDisplayMode;

			// Render margin figures (unless inline-only)
			if (displayMode !== 'inline-only' && figures.length > 0) {
				this.editFigureRenderer.render(track, figures, cmView, contentOffset);
			}

			// Hide/restore inline embeds based on display mode
			this.hideEditFigureEmbeds(cmView, figures, displayMode);
		}

		// ── Margin Code ──
		if (this.settings.marginCodeEnabled) {
			const codes = parseEditCode(docText);
			if (codes.length > 0) {
				this.editCodeRenderer.render(track, codes, cmView, contentOffset);
			}
		}

		// ── Unified collision resolution across all edit-mode margin items ──
		const allEditMarginItems = [
			...this.editSidenoteRenderer.getSidenotes(),
			...this.editCommentRenderer.getComments(),
			...this.editCodeRenderer.getCodeBlocks(),
			...this.editFigureRenderer.getFigures(),
		].sort((a, b) => parseFloat(a.dataset.refTop || '0') - parseFloat(b.dataset.refTop || '0'));
		resolveCollisions(allEditMarginItems);

		// Sync track height to match CM content height
		this.editLayout.syncTrackHeight(cmScroller.scrollHeight);

		// Set up scroll-based repositioning to correct CM6 height estimate drift
		this.setupEditScrollReposition(cmScroller, cmView);
	}

	/**
	 * Attach a scroll listener to the CM scroller that repositions edit-mode
	 * margin items on each animation frame.  This corrects drift caused by
	 * CM6's estimated line heights being replaced with real measurements as
	 * the user scrolls.
	 */
	private setupEditScrollReposition(
		cmScroller: HTMLElement,
		cmView: EditorView
	): void {
		// Clean up any previous listener (clearEditContent also does this,
		// but guard against double-attach within the same refresh cycle).
		this.editScrollCleanup?.();
		this.editScrollCleanup = null;

		let rafId: number | null = null;

		const onScroll = () => {
			if (rafId !== null) return; // already scheduled
			rafId = requestAnimationFrame(() => {
				rafId = null;
				if (this.unloaded) return;
				this.repositionEditItems(cmView);
			});
		};

		cmScroller.addEventListener('scroll', onScroll, { passive: true });

		this.editScrollCleanup = () => {
			cmScroller.removeEventListener('scroll', onScroll);
			if (rafId !== null) cancelAnimationFrame(rafId);
		};
	}

	/**
	 * Recompute `top` for every edit-mode margin item using fresh CM6
	 * geometry, then re-run collision resolution.  This is lightweight:
	 * no DOM creation, no re-parsing — just coordinate updates.
	 */
	private repositionEditItems(
		cmView: EditorView
	): void {
		const track = this.editLayout.getTrack();
		if (!track) return;

		const cmEditor = cmView.dom;
		const cmContent = cmEditor.querySelector('.cm-content') as HTMLElement;
		if (!cmContent) return;

		const trackTop = track.getBoundingClientRect().top;
		const contentOffset = cmContent.getBoundingClientRect().top - trackTop;

		const allItems = [
			...this.editSidenoteRenderer.getSidenotes(),
			...this.editCommentRenderer.getComments(),
			...this.editCodeRenderer.getCodeBlocks(),
			...this.editFigureRenderer.getFigures(),
		];

		for (const item of allItems) {
			const offsetStr = item.dataset.refOffset;
			if (!offsetStr) continue;
			const refOffset = parseInt(offsetStr, 10);
			if (isNaN(refOffset)) continue;

			// Clamp to document length to avoid CM6 throwing
			const docLen = cmView.state.doc.length;
			const safeOffset = Math.min(refOffset, docLen);

			let top: number | null = null;
			const coords = cmView.coordsAtPos(safeOffset);
			if (coords) {
				top = coords.top - trackTop;
			} else {
				try {
					top = cmView.lineBlockAt(safeOffset).top + contentOffset;
				} catch {
					continue;
				}
			}

			item.style.top = `${top}px`;
			item.dataset.refTop = `${top}px`;
		}

		// Re-sort and resolve collisions
		allItems.sort((a, b) =>
			parseFloat(a.dataset.refTop || '0') - parseFloat(b.dataset.refTop || '0')
		);
		resolveCollisions(allItems);
	}

	private hideEditFigureEmbeds(
		cmView: EditorView,
		figures: EditParsedFigure[],
		displayMode: 'margin-only' | 'both' | 'inline-only'
	): void {
		const cmContent = cmView.contentDOM;
		const embeds = cmContent.querySelectorAll('.internal-embed');

		if (displayMode === 'margin-only') {
			const docLen = cmView.state.doc.length;
			for (const fig of figures) {
				const safeOffset = Math.min(fig.refOffset, docLen);
				const lineBlock = cmView.lineBlockAt(safeOffset);
				for (const embed of Array.from(embeds)) {
					const embedRect = embed.getBoundingClientRect();
					const lineTop = cmView.coordsAtPos(safeOffset)?.top ?? -1;
					if (lineTop >= 0 && Math.abs(embedRect.top - lineTop) < lineBlock.height) {
						(embed as HTMLElement).classList.add('distill-edit-figure-hidden');
					}
				}
			}
		} else {
			for (const embed of Array.from(embeds)) {
				(embed as HTMLElement).classList.remove('distill-edit-figure-hidden');
			}
		}
	}

	private debouncedReposition(): void {
		if (this.debounceTimer) return; // refresh pending — it's a superset
		if (this.repositionTimer) clearTimeout(this.repositionTimer);
		this.repositionTimer = setTimeout(() => {
			this.repositionTimer = null;
			this.reposition();
		}, 100);
	}

	private reposition(): void {
		const id = ++this.repositionId;
		requestAnimationFrame(() => {
			if (this.unloaded) return;
			if (id !== this.repositionId) return;
			this.doReposition();
		});
	}

	private doReposition(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const currentMode = detectViewMode(view);

		// Mode switch detected — escalate to the safe double-rAF refresh path.
		// Do NOT update lastViewMode here — doRefresh() must see the mode
		// change to call teardown()/teardownEdit() at line 338.
		if (this.lastViewMode && this.lastViewMode !== currentMode) {
			this.debouncedRefresh();
			return;
		}

		// Edit mode reposition: just re-run full refresh (positions change with content)
		if (currentMode !== 'preview') {
			if (this.settings.enableInEditMode) {
				this.doEditRefresh(view, currentMode);
			}
			return;
		}

		const leafContent = view.containerEl.closest('.workspace-leaf-content') as HTMLElement;
		if (!leafContent) return;

		const previewView = leafContent.querySelector('.markdown-preview-view') as HTMLElement;
		if (!previewView) return;

		const previewSizer = previewView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!previewSizer) return;

		// In narrow mode columns are display:none — skip repositioning
		if (leafContent.classList.contains('distill-narrow')) return;

		// No containers, or containers on a different previewView (tab switch) → full refresh
		const layoutR = this.settings.columnLayout;
		const sidenoteCol = (layoutR === 'alternating' || layoutR === 'default')
			? this.layout.getRight()
			: this.layout.getLeft();
		const columnParent = this.layout.getColumnParent();
		if (!sidenoteCol?.isConnected || sidenoteCol.parentElement !== columnParent) {
			// Use debouncedRefresh (double-rAF) instead of single rAF to ensure DOM is settled
			this.debouncedRefresh();
			return;
		}

		// Reposition existing sidenotes (no DOM mutations, no feedback loop)
		if (this.settings.sidenotesEnabled) {
			this.sidenoteRenderer.reposition(previewSizer);
		}

		// Reposition all margin items via registry
		this.registry.repositionAll(previewSizer);

		// Re-sync track height after reposition
		this.layout.syncTrackHeight(previewSizer.scrollHeight);
	}

	/**
	 * Process a single section element from the post-processor.
	 * Handles all margin content types incrementally as sections load.
	 */
	private processSection(el: HTMLElement): void {
		const previewView = el.closest('.markdown-preview-view') as HTMLElement;
		if (!previewView) return;

		// Skip sections already processed with content in this generation
		if (el.dataset.distillProcessedGen === String(this.sectionGenId)) {
			return;
		}

		const sidenoteTrack = this.layout.getTrack();
		const sectionLayout = this.settings.columnLayout;
		const isAlt = sectionLayout === 'alternating';
		const altContainer = isAlt ? this.layout.getLeftTrack() ?? undefined : undefined;
		const previewSizer = previewView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!sidenoteTrack || !previewSizer) {
			if (el.isConnected && this.deferredSections.length < 200) {
				this.deferredSections.push(el);
			}
			return;
		}

		// Get source text for footnote fallback (when footnotes section is virtualized).
		// Prefer cached text from doPreviewRefresh — getActiveViewOfType may return null
		// in multi-pane setups or when the user hasn't focused this pane.
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sourceText = view?.data ?? this.cachedSourceText;

		let didRender = false;

		// ── Margin Figures (must run before sidenotes — figure parser mutates DOM) ──
		if (this.settings.marginFiguresEnabled) {
			try {
				const figures = this.figureParser.parse(el);
				if (figures.length > 0) {
					this.figureRenderer.render(sidenoteTrack, figures, previewSizer);
					didRender = true;
				}
			} catch (e) { console.error('Distill Layout: section figure parsing failed', e); }
		}

		// ── Sidenotes ──
		if (this.settings.sidenotesEnabled) {
			const customNotes = this.footnoteParser.parseCustomSyntax(el);
			let footnotesHandled = false;

			this.footnoteParser.parseSection(el, previewView, (footnotes) => {
				footnotesHandled = true;
				const all = [...footnotes, ...customNotes].sort((a, b) => {
					const pos = a.refElement.compareDocumentPosition(b.refElement);
					if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
					if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
					return 0;
				});
				if (all.length > 0) {
					this.sidenoteRenderer.render(sidenoteTrack, all, previewSizer, altContainer);
					didRender = true;
				}
			}, sourceText);

			// Only render custom notes standalone if parseSection didn't include
			// them in its callback (i.e. no standard footnote refs in this section).
			if (!footnotesHandled && customNotes.length > 0) {
				this.sidenoteRenderer.render(sidenoteTrack, customNotes, previewSizer, altContainer);
				didRender = true;
			}
		}

		// ── Margin Code ──
		if (this.settings.marginCodeEnabled) {
			try {
				const codes = this.codeParser.parse(el);
				if (codes.length > 0) {
					this.codeRenderer.render(sidenoteTrack, codes, previewSizer);
					didRender = true;
				}
			} catch (e) { console.error('Distill Layout: section code parsing failed', e); }
		}

		// ── Margin Comments ──
		if (this.settings.marginCommentsEnabled) {
			try {
				const comments = this.commentParser.parse(el);
				if (comments.length > 0) {
					this.commentRenderer.render(sidenoteTrack, comments, previewSizer);
					didRender = true;
				}
			} catch (e) { console.error('Distill Layout: section comment parsing failed', e); }
		}

		// ── Citations ──
		if (this.settings.citationsEnabled) {
			try {
				const citations = this.citationParser.parse(el);
				if (citations.length > 0) {
					this.citationRenderer.render(sidenoteTrack, citations, previewSizer);
					didRender = true;
				}
			} catch (e) { console.error('Distill Layout: section citation parsing failed', e); }
		}

		// ── Dataview ──
		if (this.settings.dataviewMarginEnabled) {
			try {
				const dataviews = this.dataviewParser.parse(el, (parsed) => {
					this.dataviewRenderer.render(sidenoteTrack, [parsed], previewSizer);
					this.registry.resolveAll();
					this.layout.syncTrackHeight(previewSizer.scrollHeight);
				});
				if (dataviews.length > 0) {
					this.dataviewRenderer.render(sidenoteTrack, dataviews, previewSizer);
					didRender = true;
				}
			} catch (e) { console.error('Distill Layout: section dataview parsing failed', e); }
		}

		// ── TOC: Link newly-rendered headings to cached entries ──
		if (this.settings.tocEnabled && this.cachedHeadings) {
			this.relinkHeadingsInSection(el, previewSizer);
		}

		if (didRender) {
			// Stamp section so it won't be re-processed. Only stamp when content
			// was found — un-stamped sections can be retried when the virtualizer
			// populates them with real content later.
			el.dataset.distillProcessedGen = String(this.sectionGenId);
			// Renumber sidenotes and create any missing inline fallbacks
			if (this.settings.sidenotesEnabled) {
				this.sidenoteRenderer.renumber(previewSizer);
				this.sidenoteRenderer.ensureInlineFallbacks(previewSizer);
			}
			this.registry.resolveAll();
			this.layout.syncTrackHeight(previewSizer.scrollHeight);
		}
	}

	/**
	 * When a section renders with headings, update cached HeadingEntry
	 * objects with real DOM elements and recalculated positions.
	 */
	private relinkHeadingsInSection(sectionEl: HTMLElement, previewSizer: HTMLElement): void {
		const headingEls = sectionEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
		if (headingEls.length === 0 || !this.cachedHeadings) return;

		const scrollContainer = previewSizer.closest('.markdown-preview-view') as HTMLElement;
		const containerRect = scrollContainer?.getBoundingClientRect() ?? previewSizer.getBoundingClientRect();
		const scrollTop = scrollContainer?.scrollTop ?? 0;
		let didUpdate = false;

		// Build a consume-queue per text to handle duplicate heading names correctly
		const queue = new Map<string, HeadingEntry[]>();
		for (const h of this.cachedHeadings) {
			if (h.element === previewSizer) {
				if (!queue.has(h.text)) queue.set(h.text, []);
				queue.get(h.text)!.push(h);
			}
		}

		for (const el of Array.from(headingEls)) {
			const heading = el as HTMLElement;
			const text = heading.textContent?.trim();
			if (!text) continue;

			const match = queue.get(text)?.shift();
			if (match) {
				match.element = heading;
				// Store in scroll-space (absolute document position) for correct threshold comparison
				match.top = heading.getBoundingClientRect().top - containerRect.top + scrollTop;
				heading.dataset.distillHeadingId = match.id;
				didUpdate = true;
			}
		}

		if (didUpdate) {
			this.tocTracker.updateHeadings(this.cachedHeadings);
			this.tocTracker.refresh();
		}
	}

	/**
	 * Watch for off-screen sections becoming available as the user scrolls.
	 * Uses two complementary strategies:
	 * 1. MutationObserver on previewSizer childList — catches virtualizer
	 *    adding/removing entire section elements.
	 * 2. Scroll listener — catches sections whose content is populated
	 *    in-place without a childList mutation on previewSizer.
	 */
	private setupSectionObserver(previewSizer: HTMLElement): void {
		// Clean up previous observers
		this.sectionObserverCleanup?.();
		this.sectionObserverCleanup = null;
		const previewView = previewSizer.closest('.markdown-preview-view') as HTMLElement;
		if (!previewView) return;

		// Capture generation at setup time — if a full refresh occurs later,
		// this observer's flushPending becomes stale and should no-op.
		const genAtSetup = this.sectionGenId;

		// Shared pending set — accumulates across debounce cycles
		let pendingSections = new Set<HTMLElement>();
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;

		const flushPending = () => {
			debounceTimer = null;
			if (this.sectionGenId !== genAtSetup) return;  // stale — full refresh supersedes
			const sections = pendingSections;
			pendingSections = new Set();
			for (const section of sections) {
				if (section.isConnected) {
					this.processSection(section);
				}
			}
		};

		const schedulePending = () => {
			if (pendingSections.size === 0) return;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(flushPending, 50);
		};

		// Strategy 1: MutationObserver for section elements added/removed
		const mo = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (node instanceof HTMLElement &&
						node.classList.contains('markdown-preview-section') &&
						node.dataset.distillProcessedGen !== String(this.sectionGenId)) {
						pendingSections.add(node);
					}
				}
			}
			schedulePending();
		});
		mo.observe(previewSizer, { childList: true });

		// Strategy 2: Scroll listener for content populated in-place
		let scrollRafId: number | null = null;
		const onScroll = () => {
			if (scrollRafId !== null) return;
			scrollRafId = requestAnimationFrame(() => {
				scrollRafId = null;
				const sections = previewSizer.querySelectorAll('.markdown-preview-section');
				for (const s of Array.from(sections)) {
					const section = s as HTMLElement;
					if (section.parentElement !== previewSizer) continue;
					if (section.dataset.distillProcessedGen === String(this.sectionGenId)) continue;
					if (section.childElementCount > 0 || (section.textContent ?? '').trim().length > 0) {
						pendingSections.add(section);
					}
				}
				schedulePending();
			});
		};
		previewView.addEventListener('scroll', onScroll, { passive: true });

		// Strategy 3: Subtree observer for content populated in-place into existing
		// placeholder sections. The virtualizer may populate content into sections
		// without adding/removing section elements (no childList mutation on sizer)
		// and without a scroll event (e.g. layout reflow, programmatic scroll).
		const subtreeMo = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				const section = (mutation.target as HTMLElement).closest?.('.markdown-preview-section') as HTMLElement;
				if (!section) continue;
				if (section.parentElement !== previewSizer) continue;
				if (section.dataset.distillProcessedGen === String(this.sectionGenId)) continue;
				if (section.childElementCount > 0 || (section.textContent ?? '').trim().length > 0) {
					pendingSections.add(section);
				}
			}
			schedulePending();
		});
		subtreeMo.observe(previewSizer, { childList: true, subtree: true });

		// (Strategy 4 removed — pre-creation handles off-screen sidenotes.
		// Strategies 1-3 + sweep handle upgrades as sections render.)

		this.sectionObserverCleanup = () => {
			mo.disconnect();
			subtreeMo.disconnect();
			previewView.removeEventListener('scroll', onScroll);
			if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
			if (debounceTimer) clearTimeout(debounceTimer);
		};
	}

	/** Clears rendered content but keeps containers alive (preview mode). */
	private clearContent(): void {
		// NOTE: deferredSections is NOT cleared here — sections deferred before
		// containers existed must survive into doPreviewRefresh's deferred processing.
		// They are cleared in teardown() instead.

		// Stop the persistent polling sweep
		if (this.sweepIntervalId) { clearInterval(this.sweepIntervalId); this.sweepIntervalId = null; }

		// Disconnect section observers so stale mutations aren't processed
		this.sectionObserverCleanup?.();
		this.sectionObserverCleanup = null;

		// Clear generation tracking so sections can be re-processed
		document.querySelectorAll('[data-distill-processed-gen]').forEach(el => {
			el.removeAttribute('data-distill-processed-gen');
		});

		this.cachedHeadings = null;
		this.tocRenderer.clear();
		this.tocTracker.disconnect();
		this.progressBar.clear();
		this.readingTime.clear();
		this.tocTooltip.detach();
		this.footnoteParser.cancelPending();
		this.sidenoteRenderer.clear();
		this.sidenoteAnimator.disconnect();
		this.figureRenderer.clear();
		this.codeRenderer.clear();
		this.commentRenderer.clear();
		this.citationRenderer.clear();
		this.dataviewRenderer.clear();
		this.registry.clear();
	}

	/** Clears edit-mode rendered content but keeps containers alive. */
	private clearEditContent(): void {
		this.editScrollCleanup?.();
		this.editScrollCleanup = null;
		this.tocRenderer.clear();
		this.editTocTracker.disconnect();
		this.editSidenoteRenderer.clear();
		this.editCommentRenderer.clear();
		this.editCodeRenderer.clear();
		this.editFigureRenderer.clear();
	}

	/** Full teardown: clears content AND removes containers (for unload/mode-switch). */
	private teardown(): void {
		this.clearContent();
		this.deferredSections = [];
		this.responsive.disconnect();
		this.layout.removeContainers();
	}

	/** Full teardown for edit mode. */
	private teardownEdit(): void {
		this.clearEditContent();
		this.deferredSections = [];
		this.responsive.disconnect();
		this.editLayout.removeContainers();
	}
}
