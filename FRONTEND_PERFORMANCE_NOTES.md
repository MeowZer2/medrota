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

## Allowed Patterns

- Static gradients and subtle static shadows.
- Short opacity/transform transitions around 100-160ms.
- Small one-off Framer Motion transitions on page headers or single modals.
- Native CSS transitions scoped to `opacity`, `transform`, `background`, `border-color`, or `color`.
- Loading shimmer only while data is actually loading.

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
