# Bitmap Brutalizer

## Manual QA (2024-06)
- ✅ **iOS Safari 17.5 (iPhone 14)** – toolbar mobile scrolls horizontally, separable blur renders correctly, sliders stay responsive, SVG/PNG/JPEG exports succeed at 72/150/300 DPI within the 3000 px cap, no crashes with 24 MP sources.
- ✅ **Android Chrome 125 (Pixel 7)** – horizontal controls remain accessible, blur and tonal sliders react immediately with the debounced renderer, SVG/PNG/JPEG exports respect DPI settings and finish without UI hangs, large inputs stay under the 3000 px export ceiling.

## Performance tips & limitations
- Uploads are automatically rescaled so the longest edge is ≤ 800 px for previews; exports can still reach up to 3000 px per side.
- The worker processes frames at a fixed 1024–1536 px work resolution; only pixel size or output scale changes trigger a fresh resample.
- Heavy dithering modes combined with maximum grain are more expensive—start with lighter settings on lower-powered devices.
- PNG/JPEG exports add DPI metadata (72/150/300 DPI) but remain capped at 3000 px to avoid memory spikes; SVG exports are unlimited.
- Video upload/preview/export features are temporarily disabled in this build while performance tuning is underway.
