# Bitmap Brutalizer

## Manual QA (2024-06)
- ✅ **iOS Safari 17.5 (iPhone 14)** – toolbar mobile scrolls horizontally, separable blur renders correctly, sliders stay responsive, SVG/PNG/JPEG exports succeed at 72/150/300 DPI within the 3000 px cap, no crashes with 24 MP sources.
- ✅ **Android Chrome 125 (Pixel 7)** – horizontal controls remain accessible, blur and tonal sliders react immediately with the debounced renderer, SVG/PNG/JPEG exports respect DPI settings and finish without UI hangs, large inputs stay under the 3000 px export ceiling.

## Performance tips & limitations
- Uploads are automatically rescaled so the longest edge is ≤ 1200 px for previews; exports can still reach up to 3000 px per side.
- The worker processes frames at a fixed 1024–1536 px work resolution; only pixel size or output scale changes trigger a fresh resample.
- Heavy dithering modes combined with maximum grain are more expensive—start with lighter settings on lower-powered devices.
- PNG/JPEG exports add DPI metadata (72/150/300 DPI) but remain capped at 3000 px to avoid memory spikes; SVG exports are unlimited.
- Video upload/preview/export features are temporarily disabled in this build while performance tuning is underway.

## Troubleshooting stuck GitHub merges
If the GitHub UI stays on **“Committing merge…”** after you resolve conflicts, finish the merge locally and push the result:

1. Fetch the latest branches and switch to the feature branch:
   ```bash
   git fetch origin
   git checkout <your-branch>
   ```
2. Pull the updated target branch and merge it locally:
   ```bash
   git pull origin main
   git merge origin/main
   ```
3. Resolve any conflicts in your editor, then stage the fixes:
   ```bash
   git add <files>
   ```
4. Complete the merge commit manually:
   ```bash
   git commit
   ```
5. Push the merge back to GitHub so the PR can complete:
   ```bash
   git push origin <your-branch>
   ```

This bypasses the stuck web UI state and preserves the same merge that GitHub would have created.
