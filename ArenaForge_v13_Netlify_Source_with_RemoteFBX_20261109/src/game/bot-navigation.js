import { TILE_SIZE, tileKey, toTile } from './map-layout.js';

const DIRECTIONS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]
];

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function nearestNavTile(tiles, x, z, blocked = () => false) {
  const ix = toTile(x), iz = toTile(z);
  if (tiles.has(tileKey(ix, iz)) && !blocked(ix * TILE_SIZE, iz * TILE_SIZE)) return { ix, iz };
  let best = null, score = Infinity;
  for (const key of tiles) {
    const [cx, cz] = key.split(',').map(Number);
    const d = dist(cx * TILE_SIZE, cz * TILE_SIZE, x, z);
    if (d >= score || blocked(cx * TILE_SIZE, cz * TILE_SIZE)) continue;
    score = d;
    best = { ix: cx, iz: cz };
  }
  return best;
}

/**
 * Dynamic A* over playable tiles. A tile is refused if occupied by scenery or a build.
 * No diagonal corner cutting, and returned routes are smoothed only across clear space.
 * Returns [] for unreachable goals so callers can choose another objective.
 */
export function findNavPath(tiles, from, goal, blocked = () => false) {
  const source = nearestNavTile(tiles, from.x, from.z, blocked);
  const destination = nearestNavTile(tiles, goal.x, goal.z, blocked);
  if (!source || !destination) return [];
  const startKey = tileKey(source.ix, source.iz);
  const goalKey = tileKey(destination.ix, destination.iz);
  const open = [{ k: startKey, x: source.ix, z: source.iz, f: 0 }];
  const cameFrom = new Map();
  const costs = new Map([[startKey, 0]]);
  const closed = new Set();
  const clear = (ix, iz) => tiles.has(tileKey(ix, iz)) && !blocked(ix * TILE_SIZE, iz * TILE_SIZE);
  const heuristic = (x, z) => dist(x, z, destination.ix, destination.iz);
  let found = false;

  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const current = open.splice(best, 1)[0];
    if (closed.has(current.k)) continue;
    if (current.k === goalKey) { found = true; break; }
    closed.add(current.k);
    for (const [dx, dz, travel] of DIRECTIONS) {
      const nx = current.x + dx, nz = current.z + dz;
      if (!clear(nx, nz)) continue;
      if (dx && dz && (!clear(current.x + dx, current.z) || !clear(current.x, current.z + dz))) continue;
      const k = tileKey(nx, nz);
      if (closed.has(k)) continue;
      const nextCost = (costs.get(current.k) ?? Infinity) + travel;
      if (nextCost >= (costs.get(k) ?? Infinity)) continue;
      costs.set(k, nextCost);
      cameFrom.set(k, current.k);
      open.push({ k, x: nx, z: nz, f: nextCost + heuristic(nx, nz) });
    }
  }
  if (!found) return [];
  const keys = [goalKey];
  while (keys[0] !== startKey) {
    const previous = cameFrom.get(keys[0]);
    if (!previous) return [];
    keys.unshift(previous);
  }
  const points = keys.map((k) => {
    const [x, z] = k.split(',').map(Number);
    return { x: x * TILE_SIZE, z: z * TILE_SIZE };
  });
  if (points.length <= 2) return points;
  const compressed = [points[0]];
  let last = 0;
  while (last < points.length - 1) {
    let target = last + 1;
    for (let i = points.length - 1; i > last + 1; i--) {
      if (segmentIsClear(tiles, points[last], points[i], blocked)) { target = i; break; }
    }
    compressed.push(points[target]);
    last = target;
  }
  return compressed;
}

export function segmentIsClear(tiles, from, to, blocked = () => false) {
  const length = dist(from.x, from.z, to.x, to.z);
  const steps = Math.max(1, Math.ceil(length / 0.4));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const x = from.x + (to.x - from.x) * f;
    const z = from.z + (to.z - from.z) * f;
    if (!tiles.has(tileKey(toTile(x), toTile(z))) || blocked(x, z)) return false;
  }
  return true;
}
