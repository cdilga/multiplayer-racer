/**
 * ViewportTiling - pure viewport tiling for camera clusters and Wife's Grid Mode
 * (br-captain-call-architecture-hardening-woq.8 / FB-camtile).
 *
 * Turns a set of camera groups (K viewports, optionally weighted) into stable,
 * readable screen rectangles that tile the host screen with NO gaps or overlap,
 * bounded aspect ratios, and HUD-safe content insets.
 *
 * Pure geometry: NO DOM, NO Three.js, NO renderer instantiation. The host wires
 * these rectangles into its real viewports; Local phones/controllers never call
 * this to build a world (they are controllers, not renderers).
 *
 *   K=1        -> one full-screen viewport (all-cars or single cluster).
 *   K=2        -> elegant two-way split (side-by-side on landscape, stacked on
 *                 portrait).
 *   K>=3       -> compact row-based rectangular tiling: pick a row count that
 *                 keeps tiles closest to a target aspect, distribute tiles across
 *                 rows as evenly as possible, and let each row's tiles span the
 *                 full width. This guarantees a perfect tiling (no gaps, no
 *                 overlap) with bounded aspect.
 *
 * Readability + performance guards live in `resolveViewportBudget`: if requested
 * viewports would produce tiles below the minimum readable size (a name/marker
 * needs real pixels), the budget is downgraded so the caller clusters into fewer,
 * larger viewports instead of unreadable slivers, and the decision is reported so
 * a degradation ladder can act BEFORE too many real viewports are created.
 */

// Default readable floor: below this a name label + own-car marker can't render
// legibly, so we downgrade instead of tiling smaller. Tuned for 1080p-class hosts.
export const DEFAULT_MIN_TILE = Object.freeze({ width: 320, height: 200 });

// HUD-safe inset applied to every tile so name/marker/HUD content never touches a
// viewport boundary (which reads as overlap between neighbouring panes).
export const DEFAULT_HUD_MARGIN = 24;

// Aspect ratios outside this band look bad (extreme letterbox / pillarbox). The
// row-count search minimises deviation from the screen aspect within this band.
export const ASPECT_BOUNDS = Object.freeze({ min: 0.4, max: 3.2 });

const EPS = 1e-6;

function clampInt(value, lo, hi) {
    return Math.max(lo, Math.min(hi, Math.round(value)));
}

/**
 * Distribute K tiles across `rows` rows as evenly as possible, deterministically.
 * Earlier rows receive the extra tiles when K doesn't divide evenly.
 * @returns {number[]} per-row tile counts (length === rows, sum === K)
 */
function tilesPerRow(k, rows) {
    const base = Math.floor(k / rows);
    let remainder = k % rows;
    const counts = [];
    for (let r = 0; r < rows; r++) {
        counts.push(base + (remainder > 0 ? 1 : 0));
        if (remainder > 0) remainder -= 1;
    }
    return counts;
}

/**
 * Aspect stats for a given row layout: worst log-deviation from `targetAspect`
 * (2x and 0.5x count equally) and the worst out-of-bounds excess (0 when every
 * tile sits inside ASPECT_BOUNDS).
 */
function layoutAspectStats(k, rows, width, height, targetAspect) {
    const counts = tilesPerRow(k, rows);
    const rowH = height / rows;
    let cost = 0;
    let boundsExcess = 0;
    for (const n of counts) {
        const aspect = (width / n) / rowH;
        cost = Math.max(cost, Math.abs(Math.log(aspect / targetAspect)));
        if (aspect > ASPECT_BOUNDS.max) boundsExcess = Math.max(boundsExcess, aspect - ASPECT_BOUNDS.max);
        else if (aspect < ASPECT_BOUNDS.min) boundsExcess = Math.max(boundsExcess, ASPECT_BOUNDS.min - aspect);
    }
    return { cost, boundsExcess };
}

/**
 * Choose the row count in [1, k]. Prefer layouts where EVERY tile is inside
 * ASPECT_BOUNDS; among those pick the one closest to `targetAspect` (screen
 * aspect by default), fewer rows winning ties. If no layout is fully in-bounds
 * (extreme K on an extreme screen), pick the one with the least bounds excess.
 * This single rule yields full-screen for K=1, a split for K=2, and compact
 * near-square grids for K>=3, all with bounded aspect where geometrically possible.
 */
function chooseRowCount(k, width, height, targetAspect) {
    let bestRows = 1;
    let bestCost = Infinity;
    let bestExcess = Infinity;
    let haveInBounds = false;
    for (let rows = 1; rows <= k; rows++) {
        const { cost, boundsExcess } = layoutAspectStats(k, rows, width, height, targetAspect);
        const inBounds = boundsExcess <= EPS;
        if (inBounds) {
            if (!haveInBounds || cost < bestCost - EPS) {
                haveInBounds = true;
                bestCost = cost;
                bestRows = rows;
            }
        } else if (!haveInBounds && boundsExcess < bestExcess - EPS) {
            bestExcess = boundsExcess;
            bestRows = rows;
        }
    }
    return bestRows;
}

/**
 * Tile a rectangle of `width` x `height` into `k` viewports.
 *
 * @param {number} k - viewport count (>= 1)
 * @param {Object} [opts]
 * @param {number} [opts.width=1920]
 * @param {number} [opts.height=1080]
 * @param {number} [opts.hudMargin=DEFAULT_HUD_MARGIN] - inset for content rect
 * @param {number|null} [opts.rows] - force a row count (else chosen automatically)
 * @param {number} [opts.targetAspect] - preferred tile aspect (default: screen aspect)
 * @returns {{width:number,height:number,count:number,rows:number,
 *   viewports: Array<{index:number,row:number,col:number,x:number,y:number,
 *     width:number,height:number,aspect:number,content:{x:number,y:number,width:number,height:number}}>}}
 */
export function tileViewports(k, opts = {}) {
    const width = opts.width ?? 1920;
    const height = opts.height ?? 1080;
    const hudMargin = opts.hudMargin ?? DEFAULT_HUD_MARGIN;
    const count = Math.max(1, Math.floor(k));
    const targetAspect = opts.targetAspect ?? (width / height);

    const rows = opts.rows ? clampInt(opts.rows, 1, count) : chooseRowCount(count, width, height, targetAspect);
    const counts = tilesPerRow(count, rows);
    const rowH = height / rows;

    const viewports = [];
    let index = 0;
    for (let r = 0; r < rows; r++) {
        const n = counts[r];
        const tileW = width / n;
        const y = r * rowH;
        for (let c = 0; c < n; c++) {
            const x = c * tileW;
            const content = {
                x: x + hudMargin,
                y: y + hudMargin,
                width: Math.max(0, tileW - 2 * hudMargin),
                height: Math.max(0, rowH - 2 * hudMargin),
            };
            viewports.push({
                index,
                row: r,
                col: c,
                x,
                y,
                width: tileW,
                height: rowH,
                aspect: tileW / rowH,
                content,
            });
            index += 1;
        }
    }

    return { width, height, count, rows, viewports };
}

/**
 * Elegant two-way split helper (K=2). Landscape -> side by side, portrait ->
 * stacked. Delegates to tileViewports with a forced row count so the shared
 * tiling invariants (no gaps/overlap, HUD insets) hold.
 */
export function splitTwo(opts = {}) {
    const width = opts.width ?? 1920;
    const height = opts.height ?? 1080;
    const landscape = width >= height;
    return tileViewports(2, { ...opts, rows: landscape ? 1 : 2 });
}

/**
 * Verify a tiling perfectly covers the screen: pairwise non-overlap and total
 * area equal to the screen area (no gaps). Returns a report the tests and the
 * runtime can assert on.
 */
export function verifyTiling(layout) {
    const { width, height, viewports } = layout;
    const screenArea = width * height;
    let sumArea = 0;
    for (const v of viewports) sumArea += v.width * v.height;

    let maxAspect = 0;
    let minAspect = Infinity;
    for (const v of viewports) {
        maxAspect = Math.max(maxAspect, v.aspect);
        minAspect = Math.min(minAspect, v.aspect);
    }

    let overlap = false;
    for (let i = 0; i < viewports.length && !overlap; i++) {
        for (let j = i + 1; j < viewports.length; j++) {
            const a = viewports[i];
            const b = viewports[j];
            const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
            const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
            if (ox > EPS && oy > EPS) { overlap = true; break; }
        }
    }

    return {
        covered: Math.abs(sumArea - screenArea) < Math.max(1, screenArea * 1e-9),
        overlap,
        maxAspect,
        minAspect,
        aspectWithinBounds: minAspect >= ASPECT_BOUNDS.min - EPS && maxAspect <= ASPECT_BOUNDS.max + EPS,
        count: viewports.length,
    };
}

/**
 * Readability + performance guard.
 *
 * Given a REQUESTED viewport count and the screen, return the largest count that
 * still yields readable tiles (>= minTile in both dimensions after HUD insets),
 * capped by maxViewports. Reports whether a downgrade happened and why, so the
 * caller feeds a degradation ladder (cluster more / go overhead) BEFORE building
 * too many real viewports.
 *
 * @returns {{requested:number, viewportCount:number, degraded:boolean,
 *   reason:(null|'below_readable'|'over_budget'), rows:number}}
 */
export function resolveViewportBudget(requested, opts = {}) {
    const width = opts.width ?? 1920;
    const height = opts.height ?? 1080;
    const hudMargin = opts.hudMargin ?? DEFAULT_HUD_MARGIN;
    const minTile = opts.minTile ?? DEFAULT_MIN_TILE;
    const maxViewports = opts.maxViewports ?? 16;
    const req = Math.max(1, Math.floor(requested));

    const readable = (k) => {
        const layout = tileViewports(k, { width, height, hudMargin });
        return layout.viewports.every((v) =>
            v.content.width >= minTile.width - EPS && v.content.height >= minTile.height - EPS);
    };

    // Largest k in [1, min(req, maxViewports)] that stays readable.
    const ceiling = Math.min(req, maxViewports);
    let best = 1;
    for (let k = 1; k <= ceiling; k++) {
        if (readable(k)) best = k;
        else break; // readability is monotonic: more tiles never get more readable
    }

    let reason = null;
    if (best < req) reason = req > maxViewports && best === maxViewports ? 'over_budget' : 'below_readable';
    if (best === maxViewports && req > maxViewports) reason = 'over_budget';

    const layout = tileViewports(best, { width, height, hudMargin });
    return {
        requested: req,
        viewportCount: best,
        degraded: best < req,
        reason: best < req ? (reason || 'below_readable') : null,
        rows: layout.rows,
    };
}

/**
 * Stable seat -> viewport assignment from the room-seat registry.
 *
 * Assignment is keyed ONLY on seatId (sorted ascending), never on join order or
 * array position, so a seat keeps its viewport slot across join/rejoin, player
 * order changes, and seat-id persistence. When there are more seats than
 * viewports, seats are distributed round-robin over viewports in stable seatId
 * order (used by cluster views); in Wife's Grid Mode viewportCount === seat count
 * so each seat owns a viewport.
 *
 * @param {Array<number|{seatId:number}>} seats - seat ids or seat objects
 * @param {number} viewportCount
 * @returns {Map<number, number>} seatId -> viewport index
 */
export function assignSeatsToViewports(seats, viewportCount) {
    const seatIds = seats
        .map((s) => (typeof s === 'object' && s !== null ? s.seatId : s))
        .filter((id) => id !== undefined && id !== null)
        .sort((a, b) => a - b);

    const vpCount = Math.max(1, Math.floor(viewportCount));
    const map = new Map();
    seatIds.forEach((seatId, i) => {
        map.set(seatId, i % vpCount);
    });
    return map;
}

/**
 * Build a Wife's Grid Mode layout: an opt-in per-player follow grid with a stable
 * seat->viewport assignment and a readability/performance downgrade when there are
 * too many seats to show legibly.
 *
 * @param {Array<number|{seatId:number}>} seats
 * @param {Object} [opts] - width/height/hudMargin/minTile/maxViewports
 * @returns {{mode:'wifes-grid', requestedViewports:number, budget:Object,
 *   layout:Object, assignment:Map<number,number>, degraded:boolean}}
 */
export function buildWifesGrid(seats, opts = {}) {
    const seatIds = seats
        .map((s) => (typeof s === 'object' && s !== null ? s.seatId : s))
        .filter((id) => id !== undefined && id !== null);
    const requested = Math.max(1, seatIds.length);

    const budget = resolveViewportBudget(requested, opts);
    const layout = tileViewports(budget.viewportCount, opts);
    const assignment = assignSeatsToViewports(seatIds, budget.viewportCount);

    return {
        mode: 'wifes-grid',
        requestedViewports: requested,
        budget,
        layout,
        assignment,
        degraded: budget.degraded,
    };
}
