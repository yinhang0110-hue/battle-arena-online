# Battle Arena V40 V33 — Start Button Fix (2–4 players)

**Fix:** Room host can now start when 2, 3, or 4 people are connected; empty player slots do not stop the game. Shop ready checks only joined players. Server sends a visible message if it rejects Start.

## Update existing GitHub repo
1. Extract this ZIP.
2. In your GitHub `battle-arena-online` repository, replace **server.js**, **package.json**, and **public/index.html** with the copies from this ZIP. Ensure `public/index.html` stays in its `public` folder. Upload other files if missing.
3. Commit changes to `main`.
4. In Render, wait for the new deploy to be **Live**. If auto-deploy is off, choose **Manual Deploy > Deploy latest commit**.
5. Both players open `https://battle-arena-online.onrender.com/`, hard-refresh with Ctrl+Shift+R, and create a NEW room. The title must show **V33**. The host presses Start after 2–4 players join.

**Important:** Existing Netlify Original Campaign and V18 saved progress are not changed. Imports still work as before. For a full four-player team, all four can join before starting.
