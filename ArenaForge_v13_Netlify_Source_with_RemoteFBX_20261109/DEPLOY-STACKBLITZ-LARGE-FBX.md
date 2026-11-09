# v13 large FBX models — no StackBlitz uploads needed

## Recommended: private GitHub repository + existing Netlify site

1. Extract this ZIP. The project root is the folder containing `package.json` and `netlify.toml`.
2. In GitHub, create a **private** repository. Mixamo raw files must not be shared in a public asset/source repository.
3. Upload the contents of this folder to that repository, preserving directory paths. Do not upload the ZIP as one opaque file. All individual FBX files are under GitHub’s 25 MiB browser-upload limit.
4. In your **existing Netlify project**, connect that private GitHub repository as the deployment source (Site configuration / Build & deploy / Repository, wording may vary). Build command `npm run build`, publish directory `dist` (also configured in netlify.toml).
5. Let Netlify deploy; visit `https://YOUR-SITE.netlify.app/models/mixamo/ch15.fbx` to confirm the model asset URL works.
6. In StackBlitz, upload/replace ONLY the small `src/game/agent-models.js` file from this package (or download the separate small loader file). **Do not upload public/models/mixamo there.**
7. In StackBlitz create/edit `.env` and set: `VITE_MIXAMO_ASSET_BASE=https://YOUR-SITE.netlify.app/models/mixamo/`. Use the real Netlify domain, and restart the Vite dev server. The development preview will fetch from Netlify.

**Note:** Your Netlify game remains deployed from GitHub so the original model assets stay included on every build. If you instead replace the Netlify deployment with a StackBlitz `dist` that omits the model assets, those assets will disappear from the live site. Keep client code changes synchronized back to the private repository for future production releases.

**Limits:** This makes the assets load externally in the StackBlitz preview, but they still need downloading into each player's browser when the game runs. It does not eliminate model loading time or guarantee that the legacy SWAT FBX works.
