# Design Brief

## Direction

VoiceCall AI — Dark-mode-first, tech/audio-aesthetic AI call automation configurator. Clean, minimal, professional.

## Tone

Refined minimalism with futuristic precision — no skeuomorphism, no gradients. Audio-first interface for voice professionals.

## Differentiation

Subtle cyan/teal accents and audio-wave motifs signal communication/voice tech without visual clutter.

## Color Palette

| Token      | Light OKLCH    | Dark OKLCH      | Role                           |
|------------|----------------|-----------------|--------------------------------|
| background | 0.99 0.004 260 | 0.14 0.008 255  | Page background, neutral base  |
| foreground | 0.15 0.01 260  | 0.93 0.01 255   | Primary text, high contrast    |
| card       | 1.0 0.0 0      | 0.18 0.01 255   | Surface for panels, elevated   |
| primary    | 0.65 0.18 195  | 0.72 0.19 195   | Cyan/teal — CTA, active state |
| accent     | 0.65 0.18 195  | 0.72 0.19 195   | Call initiation, highlights    |
| muted      | 0.95 0.01 260  | 0.24 0.025 255  | Secondary/disabled state       |
| secondary  | 0.22 0.02 280  | 0.24 0.025 280  | Violet — depth, form elements |

## Typography

- Display: Space Grotesk — geometric sans, tech edge, headlines & section titles
- Body: DM Sans — clean, legible, UI labels & body text
- Mono: JetBrains Mono — code/API config snippets, call transcripts
- Scale: Hero `text-5xl md:text-6xl font-bold tracking-tight`, H2 `text-3xl font-bold tracking-tight`, Label `text-sm font-semibold uppercase tracking-widest`, Body `text-base`

## Elevation & Depth

Layered card hierarchy: subtle border + soft shadow (`shadow-subtle`) for context, elevated shadow (`shadow-elevated` with cyan tint) for interactive elements & modals.

## Structural Zones

| Zone           | Background                    | Border       | Notes                                          |
|----------------|-------------------------------|--------------|------------------------------------------------|
| Header/Nav     | `bg-card` with border-b       | `border`     | Clear separation, logo + user menu             |
| Sidebar        | `bg-muted/10` with border-r   | `border`     | Navigation, admin access badge                 |
| Main Content   | `bg-background`               | —            | Spacious layout, breathing room                |
| Card Sections  | `bg-card` with border         | `border`     | Call config, history, settings panels          |
| Active Input   | `bg-card` focused state       | `ring`       | Cyan ring on focus (teal primary)              |
| Footer         | `bg-muted/5` with border-t    | `border`     | Minimal, secondary info                        |

## Spacing & Rhythm

Section gaps 6–8 units (24–32px), content grouping 4–6 units. Micro-spacing 2–3 units between form fields. Breathing room prioritized over density — admin/user dashboards use spacious grid.

## Component Patterns

- Buttons: Primary (cyan bg, dark text, no shadow), Secondary (outline, border), Destructive (red, reserved for call termination)
- Cards: Minimal border `border-border`, `bg-card`, `shadow-subtle`, rounded `lg`
- Badges: Uppercase label, muted bg, primary text; active/call-in-progress badge pulses soft
- Forms: Vertical stack, labels above inputs, secondary color accents for focus
- Call transcript: Monospace, dark bg panel, speaker labels in muted, slight left padding for ident

## Motion

- Entrance: Slide-in from left (0.3s ease-out) for modals, panels. Fade + scale (0.2s) for small notifications.
- Hover: Subtle elevation shadow, text color shift to primary on buttons. No scale/bounce.
- Decorative: Pulse-soft (2s) for active/recording states. No particle effects.

## Constraints

- No full-page gradients; use solid dark backgrounds only
- Cyan accent sparingly — CTAs, active indicators, focus rings only
- Shadows use OKLCH rgba with low alpha (0.05–0.12); avoid black
- Typeface hierarchy through weight + size only; no color shifts for hierarchy
- Minimum 5:1 contrast on dark mode, 7:1 on light mode for body text

## Signature Detail

Subtle cyan glow on active call state (pulsing shadow) + audio-wave waveform SVG in call history rows — distinctive audio-tech visual without overload.

