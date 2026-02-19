import { MarkdownView, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, DistillLayoutSettings } from './types';
import { DistillLayoutSettingTab, applyCSSVariables, removeCSSVariables } from './settings';
import { OverflowPatcher } from './layout/overflow-patcher';
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

	private overflow = new OverflowPatcher();
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
	private repositionTimer: ReturnType<typeof setTimeout> | null = null;
	private repositionId = 0;

	/** Track last mode to detect mode switches → full refresh */
	private lastViewMode: DistillViewMode | null = null;

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
		this.footnoteParser = new FootnoteParser(this.settings);
		this.sidenoteRenderer = new SidenoteRenderer(this.settings, this.registry);
		this.editSidenoteRenderer = new EditSidenoteRenderer(this.settings);

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
			this.citationParser.loadBibFile(this.settings.citationBibPath);
		}

		// Enable overflow patching + CSS variables
		this.overflow.enable();
		applyCSSVariables(this.settings);
		this.applyLayoutBodyClass();

		// Settings tab
		this.addSettingTab(new DistillLayoutSettingTab(this.app, this));

		// Post-processor for sidenotes (runs per-section in reading view)
		if (this.settings.sidenotesEnabled) {
			this.registerMarkdownPostProcessor((el, ctx) => {
				const gen = this.refreshId;
				// Double-rAF to wait for DOM layout
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						if (gen !== this.refreshId) return;  // a refresh was scheduled — it will handle ordering
						this.processSection(el);
					});
				});
			});
		}

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
				this.saveSettings();
				this.refresh();
			},
		});

		this.addCommand({
			id: 'toggle-sidenotes',
			name: 'Toggle Sidenotes',
			callback: () => {
				this.settings.sidenotesEnabled = !this.settings.sidenotesEnabled;
				this.saveSettings();
				this.refresh();
			},
		});

		// Initial render after workspace is ready
		this.app.workspace.onLayoutReady(() => this.refresh());
	}

	onunload(): void {
		if (this.repositionTimer) clearTimeout(this.repositionTimer);
		this.teardown();
		this.teardownEdit();
		this.overflow.disable();
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

		// Reload bibliography if path changed
		if (this.settings.citationsEnabled && this.settings.citationBibPath) {
			this.citationParser.loadBibFile(this.settings.citationBibPath);
		}
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
		this.debounceTimer = null;
		const id = ++this.refreshId;

		// Double-rAF ensures the reading view DOM is fully rendered
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
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

		const previewSizer = leafContent.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!previewSizer) return;

		// Clear old content before rebuilding (containers stay)
		this.clearContent();

		// Create/reuse column containers
		const containers = this.layout.ensureContainers(previewSizer);

		// Responsive mode detection
		this.responsive.observe(leafContent);

		// Determine which container gets TOC vs sidenotes based on layout
		const layout = this.settings.columnLayout;
		const isAlternating = layout === 'alternating';
		const swapped = layout === 'swapped';
		const tocContainer = isAlternating ? null : (swapped ? containers.right : containers.left);
		const sidenoteContainer = isAlternating ? containers.right : (swapped ? containers.left : containers.right);

		// ── TOC (disabled in alternating mode) ──
		if (this.settings.tocEnabled && tocContainer) {
			const headings = extractHeadings(previewSizer, this.settings);
			this.tocRenderer.render(tocContainer, headings);

			// Find the scroll container for IntersectionObserver
			const scrollContainer = leafContent as HTMLElement;
			this.tocTracker.observe(headings, scrollContainer);

			// ── Progress Bar ──
			if (this.settings.progressBarEnabled) {
				this.progressBar.render(tocContainer, scrollContainer);
			}

			// ── Reading Time ──
			if (this.settings.readingTimeEnabled) {
				this.readingTime.render(tocContainer, previewSizer, this.settings.wordsPerMinute);
			}

			// ── TOC Section Previews ──
			if (this.settings.tocPreviewsEnabled) {
				this.tocTooltip.attach(tocContainer, previewSizer, this.settings.tocPreviewMaxChars);
			}
		}

		// ── Sidenotes (full-document pass) ──
		if (this.settings.sidenotesEnabled && sidenoteContainer) {
			const previewView = leafContent.querySelector('.markdown-preview-view') as HTMLElement;
			if (previewView) {
				const altContainer = isAlternating ? containers.left ?? undefined : undefined;
				const currentRefreshId = this.refreshId;

				const footnotes = this.footnoteParser.parseFullDocument(previewView, (lateFootnotes) => {
					// Guard: skip if a newer refresh has started
					if (currentRefreshId !== this.refreshId) return;
					this.sidenoteRenderer.render(sidenoteContainer, lateFootnotes, previewSizer, altContainer);
					if (this.settings.sidenoteLinksEnabled && view.file) {
						for (const el of Array.from(sidenoteContainer.querySelectorAll('.distill-sidenote'))) {
							this.sidenoteLinkProcessor.process(el as HTMLElement, view.file.path, this.settings.sidenoteBacklinks);
						}
					}
					this.registry.resolveAll();
				}, view.data);

				const customNotes = this.footnoteParser.parseCustomSyntax(previewView);
				const all = [...footnotes, ...customNotes].sort((a, b) => {
					const pos = a.refElement.compareDocumentPosition(b.refElement);
					if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
					if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
					return 0;
				});
				if (all.length > 0) {
					this.sidenoteRenderer.render(sidenoteContainer, all, previewSizer, altContainer);

					if (this.settings.sidenoteLinksEnabled && view.file) {
						const sidenoteEls = sidenoteContainer.querySelectorAll('.distill-sidenote');
						for (const el of Array.from(sidenoteEls)) {
							this.sidenoteLinkProcessor.process(
								el as HTMLElement,
								view.file.path,
								this.settings.sidenoteBacklinks
							);
						}
					}
				}
			}
		}

		// ── Phase 2: New Margin Content Types ──
		if (sidenoteContainer) {
			const previewView = leafContent.querySelector('.markdown-preview-view') as HTMLElement;
			if (previewView) {
				// Margin Figures
				if (this.settings.marginFiguresEnabled) {
					try {
						const figures = this.figureParser.parse(previewView);
						if (figures.length > 0) {
							this.figureRenderer.render(sidenoteContainer, figures, previewSizer);
						}
					} catch (e) {
						console.error('Distill Layout: figure parsing failed', e);
					}
				}

				// Margin Code
				if (this.settings.marginCodeEnabled) {
					try {
						const codes = this.codeParser.parse(previewView);
						if (codes.length > 0) {
							this.codeRenderer.render(sidenoteContainer, codes, previewSizer);
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
							this.commentRenderer.render(sidenoteContainer, comments, previewSizer);
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
							this.citationRenderer.render(sidenoteContainer, citations, previewSizer);
						}
					} catch (e) {
						console.error('Distill Layout: citation parsing failed', e);
					}
				}

				// Dataview
				if (this.settings.dataviewMarginEnabled) {
					try {
						const dataviews = this.dataviewParser.parse(previewView, (parsed) => {
							// Async callback when Dataview finishes rendering
							this.dataviewRenderer.render(sidenoteContainer, [parsed], previewSizer);
							this.registry.resolveAll();
						});
						if (dataviews.length > 0) {
							this.dataviewRenderer.render(sidenoteContainer, dataviews, previewSizer);
						}
					} catch (e) {
						console.error('Distill Layout: dataview parsing failed', e);
					}
				}
			}
		}

		// ── Unified Collision Resolution (Phase 0) ──
		this.registry.resolveAll();

		// ── Sidenote Animations (Phase 1) ──
		if (this.settings.sidenoteAnimations && sidenoteContainer) {
			this.sidenoteAnimator.observe(sidenoteContainer);
		}
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

		// Access CM6 EditorView
		const cmView = (view.editor as any).cm as import('@codemirror/view').EditorView | undefined;
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
			const onItemClick = (heading: any) => {
				const linePos = heading.linePos as number | undefined;
				if (linePos != null) {
					const { EditorView } = require('@codemirror/view');
					cmView.dispatch({
						effects: EditorView.scrollIntoView(linePos, { y: 'start' }),
					});
				}
			};

			this.tocRenderer.render(tocContainer, headings, onItemClick);

			// Scroll-based active heading tracking
			this.editTocTracker.observe(headings, cmScroller);
		}

		// ── Sidenotes ──
		if (this.settings.sidenotesEnabled) {
			const docText = cmView.state.doc.toString();
			const footnotes = parseEditFootnotes(docText, this.settings.customSidenoteSyntax);

			if (footnotes.length > 0) {
				this.editSidenoteRenderer.render(track, footnotes, cmView);
			}

			// Set track height to match CM content height
			const cmContent = cmEditor.querySelector('.cm-content') as HTMLElement;
			if (cmContent) {
				// Use the full scrollable height
				this.editLayout.syncTrackHeight(cmScroller.scrollHeight);
			}
		}

		// Initial scroll sync
		this.editLayout.syncScroll();
	}

	private debouncedReposition(): void {
		if (this.debounceTimer) return; // refresh pending — it's a superset
		if (this.repositionTimer) clearTimeout(this.repositionTimer);
		this.repositionTimer = setTimeout(() => this.reposition(), 100);
	}

	private reposition(): void {
		const id = ++this.repositionId;
		requestAnimationFrame(() => {
			if (id !== this.repositionId) return;
			this.doReposition();
		});
	}

	private doReposition(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const currentMode = detectViewMode(view);

		// Edit mode reposition: just re-run full refresh (positions change with content)
		if (currentMode !== 'preview') {
			if (this.settings.enableInEditMode) {
				this.doEditRefresh(view, currentMode);
			}
			return;
		}

		const leafContent = view.containerEl.closest('.workspace-leaf-content') as HTMLElement;
		if (!leafContent) return;
		const previewSizer = leafContent.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!previewSizer) return;

		// In narrow mode columns are display:none — skip repositioning to avoid
		// resolveCollisions reading zero-height elements and corrupting positions.
		// When exiting narrow mode the padding change fires the LayoutManager
		// observer again and this method re-runs with columns visible.
		const previewView = leafContent.querySelector('.markdown-preview-view');
		if (previewView?.classList.contains('distill-narrow')) return;

		// No containers, or containers on a different sizer (tab switch) → full refresh
		const layoutR = this.settings.columnLayout;
		const sidenoteCol = (layoutR === 'alternating' || layoutR === 'default')
			? this.layout.getRight()
			: this.layout.getLeft();
		if (!sidenoteCol?.isConnected || sidenoteCol.parentElement !== previewSizer) {
			const id = ++this.refreshId;
			requestAnimationFrame(() => {
				if (id !== this.refreshId) return;
				this.doRefresh();
			});
			return;
		}

		// Reposition existing sidenotes (no DOM mutations, no feedback loop)
		if (this.settings.sidenotesEnabled) {
			this.sidenoteRenderer.reposition(previewSizer);
		}

		// Reposition all margin items via registry
		this.registry.repositionAll(previewSizer);

	}

	/**
	 * Process a single section element from the post-processor.
	 * Used for incremental sidenote rendering as sections load.
	 */
	private processSection(el: HTMLElement): void {
		if (!this.settings.sidenotesEnabled) return;

		const previewView = el.closest('.markdown-preview-view') as HTMLElement;
		if (!previewView) return;

		const sectionLayout = this.settings.columnLayout;
		const isAlt = sectionLayout === 'alternating';
		const sSwapped = sectionLayout === 'swapped';
		const sidenoteContainer = isAlt ? this.layout.getRight() : (sSwapped ? this.layout.getLeft() : this.layout.getRight());
		const altContainer = isAlt ? this.layout.getLeft() ?? undefined : undefined;
		const previewSizer = previewView.querySelector('.markdown-preview-sizer') as HTMLElement
			?? previewView.closest('.markdown-preview-sizer') as HTMLElement;

		if (!sidenoteContainer || !previewSizer) return;

		// Parse custom syntax upfront (synchronous)
		const customNotes = this.footnoteParser.parseCustomSyntax(el);

		this.footnoteParser.parseSection(el, previewView, (footnotes) => {
			// Combine footnotes with custom notes, sort by DOM position, render once
			const all = [...footnotes, ...customNotes].sort((a, b) => {
				const pos = a.refElement.compareDocumentPosition(b.refElement);
				if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
				if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
				return 0;
			});
			if (all.length > 0) {
				this.sidenoteRenderer.render(sidenoteContainer, all, previewSizer, altContainer);
				this.registry.resolveAll();
			}
		});

		// If parseSection had no refs (callback never fires), render custom notes alone.
		// The data-distill-sidenote-rendered guard prevents double-render if callback fires later.
		if (customNotes.length > 0) {
			this.sidenoteRenderer.render(sidenoteContainer, customNotes, previewSizer, altContainer);
			this.registry.resolveAll();
		}
	}

	/** Clears rendered content but keeps containers alive (preview mode). */
	private clearContent(): void {
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
		this.tocRenderer.clear();
		this.editTocTracker.disconnect();
		this.editSidenoteRenderer.clear();
	}

	/** Full teardown: clears content AND removes containers (for unload/mode-switch). */
	private teardown(): void {
		this.clearContent();
		this.responsive.disconnect();
		this.layout.removeContainers();
	}

	/** Full teardown for edit mode. */
	private teardownEdit(): void {
		this.clearEditContent();
		this.editLayout.removeContainers();
	}
}
