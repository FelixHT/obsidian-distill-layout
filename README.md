# Distill Layout

Display notes in a [Distill.pub](https://distill.pub)-inspired reading layout with a scroll-tracking table of contents and margin sidenotes.

<img width="1489" height="720" alt="image" src="https://github.com/user-attachments/assets/48270850-425b-4f57-b531-775c89d56816" />

## Features

### Scroll-tracking Table of Contents
- Floating TOC in the left margin that highlights the current section as you scroll
- Configurable heading depth (H1-H6), width, and font size
- Click any heading to jump to that section (with optional smooth scrolling)

### Margin Sidenotes
- Footnotes (`[^1]`) are automatically displayed as sidenotes in the margin, aligned next to their reference
- Custom inline syntax `{>your note}` for margin notes without footnotes
- Collision resolution prevents sidenotes from overlapping
- Collapsible long sidenotes with fade-out and expand button
- Cross-reference clicking and hover highlighting between sidenotes and their references
- Optional: show sidenotes only on hover

### Layout Options
- **Default**: TOC on the left, sidenotes on the right
- **Swapped**: TOC on the right, sidenotes on the left
- **Alternating**: Sidenotes alternate between left and right margins (no TOC)
- Responsive collapse to inline mode on narrow panes

### Style Presets
Choose from built-in presets or customize everything manually:
- **Tufte** - Classic Edward Tufte style with serif fonts
- **Academic** - Circled footnote numbers, Times New Roman
- **Minimal** - Clean and subtle
- **Dark Accent** - Accent-colored sidenote backgrounds

### Edit Mode Support
Experimental support for TOC and sidenotes in source and live preview modes.

## Installation

### From Community Plugins
1. Open **Settings** > **Community plugins**
2. Search for **Distill Layout**
3. Click **Install**, then **Enable**

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/FelixHT/obsidian-distill-layout/releases/latest)
2. Create a folder `distill-layout` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable the plugin in **Settings** > **Community plugins**

## Usage

The plugin activates automatically in reading view. Open the plugin settings to configure:

- Toggle TOC and sidenotes independently
- Adjust column widths, font sizes, and gutter spacing
- Choose a column layout (default, swapped, or alternating)
- Pick a style preset or customize colors, fonts, and badge styles
- Set the pane width threshold for responsive collapse

### Commands
- **Toggle TOC** - Show or hide the table of contents
- **Toggle Sidenotes** - Show or hide margin sidenotes

### Custom Sidenote Syntax
Add inline margin notes anywhere in your text:

```markdown
This is a paragraph with a margin note.{>This appears in the margin.}
```

Standard Obsidian footnotes also work:

```markdown
This is a paragraph with a footnote.[^1]

[^1]: This content appears as a sidenote in the margin.
```
