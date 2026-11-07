# Proctify SVG and icon guidelines

## Visual direction
All interface icons use one consistent outline style that fits the existing Proctify identity: warm ivory, terracotta clay, charcoal and muted neutral tones. Keep the current page layout, typography, assessment illustrations and course artwork unchanged.

## Shared icon treatment
- Use the shared `U()` SVG icon factory in `index.html` for interface icons.
- Use a 24 × 24 viewBox, no fill, `currentColor` stroke, 1.8 stroke width, rounded line caps and joins.
- Keep icons at approximately 1.15em in text and 18px in navigation or compact controls.
- Use `var(--icon-color, currentColor)` so icons follow the active text and theme colors automatically.
- The `.pfy-icon` class controls alignment, sizing and subtle color transitions.
- Icons are decorative when placed beside readable labels, so keep `aria-hidden="true"` and `focusable="false"`. Icon-only buttons must still have an accessible name on the button itself.

## Theme rules
- Light theme: icons inherit the surrounding charcoal or muted text color; active navigation uses the existing clay accent.
- Dark theme: icons inherit the light text color; active navigation uses the existing clay accent.
- Do not hardcode black, white or a light-only color into interface icon SVGs.
- Do not add gradients, drop shadows, multicolor fills or a second icon library for ordinary controls.

## Keep artwork distinct
Assessment charts, score visualizations, QR codes, logos, decorative illustrations and course-cover artwork are not interface icons. Preserve their existing geometry, labels, data and brand treatment. Do not force the outline icon style onto those graphics.

## Review checklist
- Check the same navigation and control icons in light and dark themes.
- Check inline icons, buttons, chips, cards and mobile navigation at small screen sizes.
- Confirm icons do not change button dimensions or push labels out of alignment.
- Confirm icon-only controls have accessible labels.
- Keep all SVGs crisp at 1× and 2× display density.
