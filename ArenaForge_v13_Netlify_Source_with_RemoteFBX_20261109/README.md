# Arena Forge v13 — Real Mixamo operatives & three-map rotation

**Built on the v12 project; uses the files you uploaded.**

## What is new

### Real animated characters

The game now loads the **actual skinned FBX models** and **separate Mixamo animation FBX clips** from the three `Basic Shooter Pack` ZIPs you supplied. We have not replaced them with procedural mannequins or sprites.

| Operative | 3D character asset | Appearance |
|---|---|---|
| Rift | Ch15 | Original textured character, orange outfit accent |
| Aegis | SWAT | SWAT model, blue team accent |
| Lumen | Ch35 | Original textured character, teal accent |
| Ember | Ch15 | Recoloured red/orange variant |
| Bastion | Ch35 | Recoloured tan/olive variant |

Each source has separate **idle, walk, run, jump, fire and reload** animation files. Third-person movement blends idle/walk/run, and shooting triggers the firing animation. The selection screen uses the same real 3D models.

**SWAT caveat:** The SWAT base model was exported in legacy FBX **6100**, below Three.js FBXLoader's documented minimum binary version of 6400. The loader tries a compatible binary header in memory; if parsing fails it automatically uses the fully textured Ch35 mesh instead of returning to the old blocky placeholder. For a reliable separate SWAT model, re-export it from Mixamo in a newer FBX version if possible.

To reduce lag and deploy time, Ch15 and Ch35's embedded PNG textures were downsampled from **4096×4096 to 1024×1024**. The mesh and bone/skin/animation data are not intentionally reduced. All files are served locally from `public/models/mixamo/`; no external asset server is required.

### Three rotating maps

The existing **Foundry Heights** map is retained. Two additional tactical maps are adapted from the two top-down layout images you supplied:

- **Foundry Heights:** two sites, large east/west routes and multi-level foundry spaces.
- **Canal Exchange:** two sites, long side flanks, central plaza, underground connecting paths and upper overhangs.
- **Triad Atrium:** **three sites (A/B/C)**, top-side attacker spawn, bottom-side defender spawn, courtyard, windows and lateral connections.

Quick Play assigns one map to every new room in rotating order. The same room switches to the next map **at the start of a new match**, not between rounds. Private room creators can choose the desired map, and local bot/drill modes also have a selection menu. The server owns the selection; clients joining a room receive the same map ID. Spawn routes and planting/defusing for Site C are included.

Both new maps are playable original approximations of your drawings, **not exact architectural reproductions**. They use the existing collision, navigation and gameplay rules; they need visual validation in the browser.

## Install: StackBlitz

From the **upgrade ZIP**, replace:

- `src/App.jsx`
- `src/AgentSelector.jsx`
- `src/styles.css`
- `src/game/arena-engine.js`
- `src/game/agent-models.js`
- `src/game/map-layout.js`
- `src/game/photo-city-models.js`

Add new file:

- `src/game/map-variants.js`

**Add the entire `public/models/mixamo/` folder, with all 21 FBX files.** The character model FBXs and animation FBXs must keep their filenames and locations. Do not place the original three large ZIPs in your project: we have already provided optimized individual files.

Leave the rest of the V12 client project untouched. Run `npm run build` to regenerate `dist`, then redeploy that folder to your existing Netlify site. The new Netlify build will be larger because of the real character models.

## Install: Render (required for multiplayer map rotation)

In your Render server project replace:

- `server/index.js`
- `server/match-core.js`
- `server/map-layout.js`

Add:

- `server/map-variants.js`

Your hardcoded server remains **https://forlornant.onrender.com**. There is no need to create a new Render service; update the existing repo and redeploy it. Client v13 and server v13 should be deployed together for shared map IDs, new spawn locations and three-site objective validation.

## Tests and limits

- All pre-existing rule tests and the new map-rotation tests have passed.
- Source files parse syntactically.
- Both spawns have connected 2m-grid paths to every active site on every map.
- Optimized FBX files retain their embedded textures and their animation clips are included.

**Not verified in this environment:** complete Vite browser compilation, actual skinning/rendering in WebGL, performance on your laptop, nor a live two-player session. Test in StackBlitz first. In particular, confirm actual models load (check Console for FBX warnings), animations play, bots navigate the new maps and Quick Play rotations happen between matches. The legacy SWAT FBX may fall back to Ch35 until re-exported.

## Gameplay carried over from v12

- Five operatives with passive, signature, two paid utilities and ultimate.
- Ability & weapon economy and character-select phase.
- Quick Play, private rooms, Play with Bots and drills.
- Building system with wall-edge snapping and raised build layers.
