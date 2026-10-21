# Battle Arena V43 — Animated Sprites

Replaces the V42 sliding full-body photos with actual frame-by-frame sprite sheets.

Each sprite sheet has four facing directions and eight poses per direction:
- 2 idle frames
- 4 run cycle frames with articulated moving legs
- 1 firing/attack frame
- 1 damaged/stagger frame

Original scenic backgrounds, boss artwork, original music, progression, V18 saves, admin, online rooms and server logic remain present. Character art pictures are kept under public/assets for future portraits, but moving actors use `hero_sheet_*.png`, `enemy_sheet_*.png`, and `boss_sheet_*.png`.

To deploy: upload all files and folders (including public/assets) to the existing Github repository, commit, and wait for Render to redeploy. No Netlify credits needed.

This is 2D animated sprite combat, not 3D or motion-captured animation.
