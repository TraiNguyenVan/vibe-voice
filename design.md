# Vibe Voice Design Guidelines

## Overview

Vibe Voice is a Tauri 2 desktop widget for push-to-talk speech-to-text on Linux/Wayland. The entire user interface is rendered in **JetBrains Mono** — every label, status indicator, character, and text element sits in the same monospaced face. 

The visual identity is defined by a flat, dark, keyboard-centric TUI (Terminal User Interface) aesthetic:
- Every action and status is represented by bracketed ASCII characters (`[~]`, `[x]`, `[-]`, `[●]`, `[✓]`) in place of vector icons.
- There is no sans-serif, no display face, and no decorative ornament. The system is one font and one weight away from being a terminal window.
- The window is styled with flat borders and sharp rectangles, utilizing a tight 4px border radius for interactive elements (such as buttons, inputs, and toggle switches) and sharp edges for the main window container.

---

## Colors

The color palette is dark, high-contrast, and neutral, designed to blend cleanly with Wayland desktop compositors.

### Primary Palette
- **Canvas / Background** (`--bg` / `#090a0f`): Deep carbon-black canvas. Used for the settings panel backdrop and overall application base.
- **Surface** (`--surface` / `linear-gradient(135deg, #1b1c24 0%, #0e0f13 100%)`): Sleek dark gray gradient used for the main widget frame.
- **Ink / Text** (`--text` / `#f1f5f9`): Cool titanium white. Used for readable headers and primary text labels.
- **Muted** (`--muted` / `#64748b`): Slate gray. Used for helper text, instructions, and non-emphasized UI labels.

### Borders & Highlights
- **Hairline Border** (`--border` / `rgba(255, 255, 255, 0.05)`): Thin, translucent border.
- **Border Highlight** (`--border-hi` / `rgba(255, 255, 255, 0.12)`): Stronger boundary lines on the outer window and keycaps.
- **Accent** (`--accent` / `#f8fafc`): Pure titanium white for highlighted actions and focused borders.
- **Accent Warm** (`--accent-warm` / `#94a3b8`): Medium slate gray.
- **Accent Dim** (`--accent-dim` / `rgba(255, 255, 255, 0.06)`): Active button click tint.

### Semantic States
- **Recording / Red** (`--red` / `#ef4444`): Active PTT recording border and `[●]` status indicator.
- **Recording Dim** (`--red-dim` / `rgba(239, 68, 68, 0.12)`): Background fill for the recording PTT button.
- **Done / Green** (`--green` / `#10b981`): Transcription complete `[✓]` indicator.
- **Done Dim** (`--green-dim` / `rgba(16, 185, 129, 0.12)`): Done state feedback.
- **Error / Orange** (`--orange` / `#f59e0b`): Warning / issue status `[!]`.

---

## Typography

### Font Family
**JetBrains Mono** (loaded from Google Fonts) is the exclusive font family. It falls back through a standard system monospace stack: `ui-monospace`, `monospace`.

### Hierarchy
- **Primary Labels & Title** (`11px`, Regular): Window title, help keys, settings panel labels.
- **Status Value** (`17px`, Bold): Primary state description ("Hold to record", "Recording...").
- **Transcript Text** (`13px`, Regular, Italic): Displays transcribing output.
- **Buttons / Actions** (`11px` - `13px`, Bold): Centered bracket text (`[~]`, `[x]`, `PTT`).

---

## Layout & Shapes

### Geometry & Spacing
- **Dimensions**: Fixed width of `340px`. Height is dynamic and automatically shrinks/grows using a ResizeObserver to fit its content (typically `160px` in idle state, extending slightly when settings are open).
- **Radius Scale**:
  - `0px` (`rounded.none`): Main container (`#app`), settings panel overlay, waveform blocks.
  - `4px` (`rounded.sm`): PTT button keycap, input fields, checkboxes/switches.
- **No Shadows**: The UI is flat. Depth is created entirely through contrasting border weights and flat colors.

---

## Key Components

### PTT Button (Keycap Interaction)
- Styled to resemble a physical mechanical keyboard keycap:
  - Default: `height: 56px`, `border-radius: 4px`, with a thick bottom edge shadow border (`border-bottom: 3px solid rgba(255, 255, 255, 0.15)`).
  - Hover: Outline border turns white (`var(--accent)`).
  - Active (Press): The button visual box compresses to `54px` and a `margin-top: 2px` is added, physically depressing the key downward while keeping the vertical footprint stable.
  - Recording: Border turns flat red (`var(--red)`) and background becomes `var(--red-dim)`.

### Titlebar & Window Chrome
- **Integrated Brand Logo**: The 16x16px application logo (`#app-logo`, `border-radius: 2px`) is placed at the top left of the title bar, next to the "Vibe Voice" label.
- **Active State Border Glow**: The logo's border dynamically changes color and glows based on status:
  - Idle: `border: 1px solid var(--border)`
  - Recording: Red border with pulsing red glow animation
  - Thinking: Silver border with dim glow
  - Done: Green border with green glow
  - Error: Orange border with orange glow
- **Titlebar Actions**: `[~]` (settings) and `[x]` (close window) separated by a clean `8px` gap.

### TUI Waveform
- Drawn using flat, vertical rectangular blocks (`border-radius: 0`) colored in `var(--accent-warm)`. The sharp rectangular design reinforces the monospaced grid cell style.

### Settings Panel Inputs
- **Groq API Key**: A clean input text field (`border-radius: 4px`, `padding: 8px 12px`) without icons. The border lights up flat on focus with no halo glow.
- **Auto-Type Switch**: A square toggle slider (`border-radius: 4px`) containing a small square dot selector indicator that shifts left/right on state changes.

---

## Do's and Don'ts

### Do
- Render every single element in `JetBrains Mono`.
- Use a sleek, premium dark gray gradient for the application surface background to give it depth, while keeping inner sub-panels and controls solid carbon black.
- Use only character brackets (`[-]`, `[●]`, `[✓]`, `[~]`, `[x]`) for status displays and action controls.
- Maintain the physical keyboard keycap animation on the PTT button to offer satisfying micro-interaction feedback.
- Rely on dynamic window resizing to fit content instead of allowing vertical scrollbars or overflows.

### Don't
- Don't use Lucide or any other vector SVG icons in the UI. 
- Don't apply drop shadows, radial glows, blur filters, or round circle indicator dots.
- Don't add a font fallback outside of monospace.
- Don't alter the `340px` window width boundary.
