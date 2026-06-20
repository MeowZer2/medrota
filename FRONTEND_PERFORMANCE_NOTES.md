# Frontend Performance Notes

## Motion Regression Root Cause

The app shell used a full-page animated gradient background on the main content area:

```css
.animated-bg {
  background-size: 400% 400%;
  animation: gradientShift 18s ease infinite;
}
```

Because this background covered every authenticated page, the browser repainted the main surface continuously. That made unrelated interactions feel slow: calendar day clicks, cards, sidebar navigation, and modals were all happening on top of constant paint work.

Secondary contributors were infinite box-shadow animations on calendar cells, blurred modal backdrops, and Framer Motion `layout` animations on repeated resident rows.

## Banned Patterns

- Full-page infinite background-position animations.
- Infinite box-shadow, blur, or filter animations.
- `transition-all` on frequently clicked controls.
- Framer Motion `layout` on repeated rows/cards unless there is a measured need.
- Animated hover shadows on repeated cards or list items.
- Backdrop blur on frequently opened modals and overlays.

Examples:

```css
/* Banned: repaints the whole app shell continuously. */
.animated-bg {
  background-size: 400% 400%;
  animation: gradientShift 18s ease infinite;
}

/* Banned: animates every changed property, including expensive ones. */
.button {
  transition: all 300ms ease;
}

/* Banned: blur on frequently opened overlays. */
.modal-backdrop {
  backdrop-filter: blur(4px);
}
```

## Allowed Patterns

- Static gradients and subtle static shadows.
- Short opacity/transform transitions around 100-180ms.
- Small one-off Framer Motion transitions on page headers or single modals.
- Native CSS transitions scoped to `opacity`, `transform`, `background`, `border-color`, or `color`.
- Loading-only spinner/shimmer animations.
- Static gradients in the authenticated app shell.

Examples:

```css
/* Allowed: static premium background. */
.animated-bg {
  background:
    radial-gradient(circle at 20% 0%, rgba(238,244,255,0.72), rgba(248,250,252,0) 34%),
    linear-gradient(135deg, #F8FAFC 0%, #EEF4FF 48%, #F8FAFC 100%);
}

/* Allowed: specific, short transition. */
.button {
  transition: background 120ms ease, color 120ms ease;
}

/* Allowed: visible only during loading. */
.spinner {
  animation: spin 0.8s linear infinite;
}
```

## Automated Guard

Run this before committing frontend changes from design imports or AI-generated UI:

```bash
cd frontend
npm run perf:guard
```

The guard fails on severe repaint-heavy patterns and prints warnings for softer risks that need review.

Current known warning:

- `src/pages/Calendar.jsx` has an animated box-shadow used for a low-frequency publish pulse. The guard passes and reports it as a review warning, not a blocker.
- `npm run build` currently reports a Vite chunk-size warning above 500 kB. Defer code splitting until it becomes a measured performance issue or release requirement.

## Review Checklist

Before importing or adapting design-tool output, search for:

```text
transition: all
transition-all
background-size: 400%
animation: .* infinite
backdrop-filter
filter
box-shadow
layout
whileHover
whileTap
```

Keep visual polish, but avoid animation work that runs every frame across large areas.
