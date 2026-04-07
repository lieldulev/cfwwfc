
/**
 * @interface TileType
 * @description The definition of a tile, what you use to describe the tileset and the rules of placement
 */
export interface TileType {
    edges: number; // Number of edges, in clockwise order
    rotations: Array<number>; // Rotations in degrees, in clockwise order
    getEdgePosition(x: number, y: number, edge: number): [number, number];
}


/**
 * @constant SquareTilePositions
 * @description The definition of a square (has 4 edges) tile, that can be rotated 90 degrees.
 */
export const SquareTilePositions: TileType = {
    edges: 4, // clockwise 1 - top, 2 - right, 3 - bottom, 4 - left
    rotations: [0, 90, 180, 270],
    getEdgePosition(x: number, y: number, edge: number): [number, number] {
        switch (edge) {
            case 1:
                return [x, y - 1];
            case 2:
                return [x + 1, y];
            case 3:
                return [x, y + 1];
            case 4:
                return [x - 1, y];
        }
        throw new Error('Invalid edge');
    }
}

/**
 * @constant HexagonTilePositions
 * @description Pointy-top hex grid in axial (q,r) stored as (x,y). Six neighbors are symmetric and listed clockwise.
 */
export const HexagonTilePositions: TileType = {
    edges: 6,
    rotations: [0, 60, 120, 180, 240, 300],
    getEdgePosition(x: number, y: number, edge: number): [number, number] {
        switch (edge) {
            case 1:
                return [x + 1, y - 1];
            case 2:
                return [x + 1, y];
            case 3:
                return [x, y + 1];
            case 4:
                return [x - 1, y + 1];
            case 5:
                return [x - 1, y];
            case 6:
                return [x, y - 1];
        }
        throw new Error('Invalid edge');
    }
}

/**
 * Triangular tiling on the same integer grid as squares: each cell `(x,y)` is one triangle.
 * Parity of `x + y` picks orientation: **even** = up-pointing (△), **odd** = down-pointing (▽).
 * Edges are numbered **clockwise** from a fixed compass anchor on that triangle:
 * - **Up (△):** 1 = west, 2 = south, 3 = east — neighbors `(x-1,y)`, `(x,y+1)`, `(x+1,y)`.
 * - **Down (▽):** 1 = north, 2 = east, 3 = west — neighbors `(x,y-1)`, `(x+1,y)`, `(x-1,y)`.
 */
export const TriangleTilePositions: TileType = {
    edges: 3,
    rotations: [0, 120, 240],
    getEdgePosition(x: number, y: number, edge: number): [number, number] {
        const up = ((x + y) & 1) === 0;
        if (up) {
            switch (edge) {
                case 1:
                    return [x - 1, y];
                case 2:
                    return [x, y + 1];
                case 3:
                    return [x + 1, y];
            }
        } else {
            switch (edge) {
                case 1:
                    return [x, y - 1];
                case 2:
                    return [x + 1, y];
                case 3:
                    return [x - 1, y];
            }
        }
        throw new Error('Invalid edge');
    }
}

function cellKey(x: number, y: number): string {
    return `${x},${y}`;
}

/**
 * Tracks uncollapsed cells by entropy (superposition size) for O(1) amortized minimum-entropy picks.
 * Must be updated whenever `superposition[x][y]` changes or `tilemap[x][y]` collapses.
 */
export class EntropyIndex {
    private readonly buckets = new Map<number, Set<string>>();
    private minEntropy = Infinity;
    private readonly maxEntropy: number;

    constructor(
        w: number,
        h: number,
        tilemap: TiledMap,
        superposition: SuperpositionMap,
        maxEntropy: number
    ) {
        this.maxEntropy = maxEntropy;
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                if (tilemap[i][j] !== undefined) {
                    continue;
                }
                const n = superposition[i][j].size;
                if (n > 0) {
                    this.addToBucket(n, i, j);
                }
            }
        }
        this.recomputeMin();
    }

    /** Current minimum superposition size among indexed uncollapsed cells (same as WFC minimum-entropy heuristic). */
    getMinEntropy(): number {
        return this.minEntropy;
    }

    private addToBucket(n: number, i: number, j: number): void {
        const k = cellKey(i, j);
        let set = this.buckets.get(n);
        if (!set) {
            set = new Set();
            this.buckets.set(n, set);
        }
        set.add(k);
    }

    private removeFromBucket(n: number, i: number, j: number): void {
        const set = this.buckets.get(n);
        if (!set) {
            return;
        }
        set.delete(cellKey(i, j));
        if (set.size === 0) {
            this.buckets.delete(n);
        }
    }

    private recomputeMin(): void {
        this.minEntropy = Infinity;
        for (const e of this.buckets.keys()) {
            if (e < this.minEntropy) {
                this.minEntropy = e;
            }
        }
        if (this.buckets.size === 0) {
            this.minEntropy = Infinity;
        }
    }

    /** Call after `superposition[x][y]` was replaced and the cell is still uncollapsed. */
    noteSuperpositionSizeChange(x: number, y: number, oldSize: number, newSize: number): void {
        if (oldSize === newSize) {
            return;
        }
        if (oldSize > 0) {
            this.removeFromBucket(oldSize, x, y);
        }
        if (newSize > 0) {
            this.addToBucket(newSize, x, y);
        }
        if (newSize > 0 && newSize < this.minEntropy) {
            this.minEntropy = newSize;
        }
        if (oldSize === this.minEntropy && !this.buckets.has(oldSize)) {
            this.recomputeMin();
        }
    }

    /** Call when a cell collapses (superposition cleared). */
    noteCollapsed(x: number, y: number, previousSuperpositionSize: number): void {
        if (previousSuperpositionSize > 0) {
            this.removeFromBucket(previousSuperpositionSize, x, y);
        }
        if (previousSuperpositionSize === this.minEntropy && !this.buckets.has(previousSuperpositionSize)) {
            this.recomputeMin();
        }
    }

    /**
     * Same contract as {@link selectMinEntropyCell}: uniform tie-break among minimum-entropy uncollapsed cells.
     */
    pickMinEntropyCell(tilemap: TiledMap, superposition: SuperpositionMap): [number, number] | null {
        while (this.minEntropy <= this.maxEntropy) {
            const set = this.buckets.get(this.minEntropy);
            if (!set || set.size === 0) {
                this.buckets.delete(this.minEntropy);
                this.recomputeMin();
                if (this.minEntropy === Infinity) {
                    return null;
                }
                continue;
            }
            let pick: [number, number] | null = null;
            let eligible = 0;
            for (const k of set) {
                const comma = k.indexOf(',');
                const i = Number(k.slice(0, comma));
                const j = Number(k.slice(comma + 1));
                if (tilemap[i][j] !== undefined) {
                    continue;
                }
                const n = superposition[i][j].size;
                if (n === 0) {
                    continue;
                }
                if (n === this.minEntropy) {
                    eligible++;
                    if (Math.random() < 1 / eligible) {
                        pick = [i, j];
                    }
                }
            }
            if (eligible === 0) {
                for (const k of [...set]) {
                    const comma = k.indexOf(',');
                    const i = Number(k.slice(0, comma));
                    const j = Number(k.slice(comma + 1));
                    this.removeFromBucket(this.minEntropy, i, j);
                    const n = superposition[i][j].size;
                    if (tilemap[i][j] === undefined && n > 0) {
                        this.addToBucket(n, i, j);
                    }
                }
                this.recomputeMin();
                continue;
            }
            return pick!;
        }
        return null;
    }
}

/**
 * Uncollapsed cells hold allowed `(id, rotation)` keys. Collapsed cells use an empty set; the tile is only in `tilemap`.
 */
export type SuperpositionMap = Array<Array<Set<string>>>;

/** Hint appended to contradiction errors (Option A: fail fast). */
export const WFC_CONTRADICTION_HINT =
    'Try a larger map, relax adjacency rules, or use a less restrictive tileset.';

export function formatWfcContradictionMessage(x: number, y: number, detail: string): string {
    return `Wave function contradiction at (${x}, ${y}): ${detail} ${WFC_CONTRADICTION_HINT}`;
}

function inBounds(x: number, y: number, w: number, h: number): boolean {
    return x >= 0 && x < w && y >= 0 && y < h;
}

/**
 * Grid edge index on (x,y) that points toward the neighbor; returns the neighbor's edge index that points back.
 */
export function getOppositeEdge(tileType: TileType, x: number, y: number, edge: number): number {
    const [nx, ny] = tileType.getEdgePosition(x, y, edge);
    for (let e = 1; e <= tileType.edges; e++) {
        const [bx, by] = tileType.getEdgePosition(nx, ny, e);
        if (bx === x && by === y) {
            return e;
        }
    }
    throw new Error(`No opposite edge for cell (${x},${y}) edge ${edge}`);
}

/** Maps a grid/socket edge (fixed compass on the cell) to this tile's local edge index after clockwise rotation. */
export function gridEdgeToLocalEdge(tileType: TileType, gridEdge: number, rotation: number): number {
    const n = tileType.edges;
    const stepDegrees = 360 / n;
    const steps = Math.round(rotation / stepDegrees) % n;
    const ge = gridEdge - 1;
    return ((ge - steps) % n + n) % n + 1;
}

/** Inverse of {@link gridEdgeToLocalEdge}: which grid edge (compass on the cell) corresponds to a given local edge at `rotation`. */
export function gridEdgeFromLocalEdge(tileType: TileType, localEdge: number, rotation: number): number {
    const n = tileType.edges;
    const stepDegrees = 360 / n;
    const steps = Math.round(rotation / stepDegrees) % n;
    const L = localEdge - 1;
    const G = ((L + steps) % n + n) % n;
    return G + 1;
}

function computeVariantsCompatible(
    tileType: TileType,
    tileset: Map<string, TileDefinition>,
    a: TileInstance,
    b: TileInstance,
    ax: number,
    ay: number,
    edgeFromA: number
): boolean {
    const defA = tileset.get(a.id);
    const defB = tileset.get(b.id);
    if (!defA || !defB) {
        return false;
    }
    const edgeFromB = getOppositeEdge(tileType, ax, ay, edgeFromA);
    const localA = gridEdgeToLocalEdge(tileType, edgeFromA, a.rotation);
    const localB = gridEdgeToLocalEdge(tileType, edgeFromB, b.rotation);
    if (!defA.edgeAllowed(localA) || !defB.edgeAllowed(localB)) {
        return false;
    }
    return defA.tileAllowed(localA, a, b, localB) && defB.tileAllowed(localB, b, a, localA);
}

/**
 * True iff variant `b` can sit on the neighbor reached from `a` at (ax,ay) along grid edge `edgeFromA`.
 * Optional `compatibilityCache` memoizes results per grid site and variant pair (used during propagation).
 */
export function variantsCompatible(
    tileType: TileType,
    tileset: Map<string, TileDefinition>,
    a: TileInstance,
    b: TileInstance,
    ax: number,
    ay: number,
    edgeFromA: number,
    compatibilityCache?: Map<string, boolean>
): boolean {
    if (!compatibilityCache) {
        return computeVariantsCompatible(tileType, tileset, a, b, ax, ay, edgeFromA);
    }
    const key = `${ax},${ay},${edgeFromA},${encodeVariantKey(a.id, a.rotation)},${encodeVariantKey(b.id, b.rotation)}`;
    const hit = compatibilityCache.get(key);
    if (hit !== undefined) {
        return hit;
    }
    const v = computeVariantsCompatible(tileType, tileset, a, b, ax, ay, edgeFromA);
    compatibilityCache.set(key, v);
    return v;
}

function neighborVariantStillAllowed(
    tileType: TileType,
    tileset: Map<string, TileDefinition>,
    sx: number,
    sy: number,
    edgeFromSource: number,
    neighborVariant: TileVariant,
    tilemap: TiledMap,
    superposition: SuperpositionMap,
    compatibilityCache?: Map<string, boolean>
): boolean {
    if (tilemap[sx][sy] !== undefined) {
        return variantsCompatible(
            tileType,
            tileset,
            tilemap[sx][sy]!,
            neighborVariant,
            sx,
            sy,
            edgeFromSource,
            compatibilityCache
        );
    }
    const sourceSup = superposition[sx][sy];
    for (const key of sourceSup) {
        const s = tileVariantFromKey(key, tileset);
        if (variantsCompatible(tileType, tileset, s, neighborVariant, sx, sy, edgeFromSource, compatibilityCache)) {
            return true;
        }
    }
    return false;
}

/** Options for {@link runPropagation}, {@link propagateFrom}, and {@link propagateAllCollapsed}. */
export type WfcPropagationOptions = {
    forceCollapse?: boolean;
    /** When set, superposition size changes during this propagation must be reflected here (see {@link EntropyIndex}). */
    entropyIndex?: EntropyIndex;
    /** Memoize variant-pair compatibility checks for this propagation pass. */
    compatibilityCache?: Map<string, boolean>;
};

/**
 * Propagate constraints from every coordinate in `seeds` until quiescence (same underlying engine as {@link propagateFrom}).
 */
export function runPropagation(
    w: number,
    h: number,
    tileType: TileType,
    tileset: Map<string, TileDefinition>,
    tilemap: TiledMap,
    superposition: SuperpositionMap,
    seeds: ReadonlyArray<[number, number]>,
    options?: WfcPropagationOptions
): void {
    runConstraintPropagation(w, h, tileType, tileset, tilemap, superposition, [...seeds], options);
}

function runConstraintPropagation(
    w: number,
    h: number,
    tileType: TileType,
    tileset: Map<string, TileDefinition>,
    tilemap: TiledMap,
    superposition: SuperpositionMap,
    seedQueue: Array<[number, number]>,
    options?: WfcPropagationOptions
): void {
    const forceCollapse = options?.forceCollapse !== false;
    const entropyIndex = options?.entropyIndex;
    const compatibilityCache = options?.compatibilityCache;
    const queue: Array<[number, number]> = [...seedQueue];
    let qHead = 0;

    while (qHead < queue.length) {
        const [sx, sy] = queue[qHead++]!;

        if (!inBounds(sx, sy, w, h)) {
            continue;
        }

        const collapsedHere = tilemap[sx][sy] !== undefined;
        if (!collapsedHere && superposition[sx][sy].size === 0) {
            throw new Error(
                formatWfcContradictionMessage(sx, sy, 'uncollapsed cell has an empty superposition while propagating.')
            );
        }

        for (let e = 1; e <= tileType.edges; e++) {
            const [nx, ny] = tileType.getEdgePosition(sx, sy, e);
            if (!inBounds(nx, ny, w, h)) {
                continue;
            }
            if (tilemap[nx][ny] !== undefined) {
                continue;
            }

            const before = superposition[nx][ny];
            const filtered = new Set<string>();
            for (const key of before) {
                const v = tileVariantFromKey(key, tileset);
                if (
                    neighborVariantStillAllowed(
                        tileType,
                        tileset,
                        sx,
                        sy,
                        e,
                        v,
                        tilemap,
                        superposition,
                        compatibilityCache
                    )
                ) {
                    filtered.add(key);
                }
            }

            if (filtered.size === before.size) {
                continue;
            }

            const oldNeighborSize = before.size;
            superposition[nx][ny] = filtered;
            entropyIndex?.noteSuperpositionSizeChange(nx, ny, oldNeighborSize, filtered.size);

            if (filtered.size === 0) {
                throw new Error(
                    formatWfcContradictionMessage(nx, ny, 'no compatible variants left after constraining from a neighbor.')
                );
            }

            if (forceCollapse && filtered.size === 1) {
                const key = filtered.values().next().value!;
                const { id, rotation } = decodeVariantKey(key);
                tilemap[nx][ny] = { id, rotation };
                superposition[nx][ny] = new Set();
                entropyIndex?.noteCollapsed(nx, ny, 1);
            }

            queue.push([nx, ny]);
        }
    }
}

/**
 * Queue-based constraint propagation until quiescence. Collapsed cells use `tilemap`; uncollapsed cells use `superposition`.
 * Optionally forces collapse when a superposition narrows to one variant.
 */
export function propagateFrom(
    w: number,
    h: number,
    tileType: TileType,
    tileset: Map<string, TileDefinition>,
    tilemap: TiledMap,
    superposition: SuperpositionMap,
    originX: number,
    originY: number,
    options?: WfcPropagationOptions
): void {
    runPropagation(w, h, tileType, tileset, tilemap, superposition, [[originX, originY]], options);
}

/** Propagate from every collapsed cell (e.g. after seeding). */
export function propagateAllCollapsed(
    w: number,
    h: number,
    tileType: TileType,
    tileset: Map<string, TileDefinition>,
    tilemap: TiledMap,
    superposition: SuperpositionMap,
    options?: WfcPropagationOptions
): void {
    const seeds: Array<[number, number]> = [];
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            if (tilemap[x][y] !== undefined) {
                seeds.push([x, y]);
            }
        }
    }
    runPropagation(w, h, tileType, tileset, tilemap, superposition, seeds, options);
}

/**
 * Uniform random cell for the first collapse when there is no seed.
 *
 * - **Interior-only** when both `w >= 3` and `h >= 3`: pick from `[1, w-2] × [1, h-2]` (never on the map border).
 * - **Smaller maps** (`w < 3` or `h < 3`): pick from the full in-bounds range on each axis that is “thin”,
 *   and use the interior slice only on axes with length ≥ 3 (e.g. `3×1` → center column; `1×3` → center row;
 *   `2×2` → any cell).
 *
 * Single-row / single-column maps always yield exactly one valid coordinate on the short axis.
 */
export function pickInitialCell(w: number, h: number): [number, number] {
    if (w < 1 || h < 1 || !Number.isInteger(w) || !Number.isInteger(h)) {
        throw new Error(`pickInitialCell requires positive integer dimensions (got ${w}×${h})`);
    }
    const minX = w > 2 ? 1 : 0;
    const maxX = w > 2 ? w - 2 : w - 1;
    const minY = h > 2 ? 1 : 0;
    const maxY = h > 2 ? h - 2 : h - 1;
    const x = minX + Math.floor(Math.random() * (maxX - minX + 1));
    const y = minY + Math.floor(Math.random() * (maxY - minY + 1));
    return [x, y];
}

/**
 * After propagation, whether generation can finish, should stop with failure, or may pick another cell.
 */
export type GenerationStatus =
    | { kind: 'complete' }
    | { kind: 'continue' }
    | { kind: 'contradiction'; x: number; y: number };

export function getGenerationStatus(
    w: number,
    h: number,
    tilemap: TiledMap,
    superposition: SuperpositionMap
): GenerationStatus {
    let hasUncollapsed = false;
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            if (tilemap[i][j] !== undefined) {
                continue;
            }
            hasUncollapsed = true;
            if (superposition[i][j].size === 0) {
                return { kind: 'contradiction', x: i, y: j };
            }
        }
    }
    if (!hasUncollapsed) {
        return { kind: 'complete' };
    }
    return { kind: 'continue' };
}

/**
 * Remaining variant count at `(i,j)` (size of the superposition set). Collapsed cells typically have an empty set (0).
 * Callers that compute minimum entropy over the grid should skip collapsed cells via `tilemap` rather than relying on this alone.
 */
export function getEntropy(superposition: SuperpositionMap, _tilemap: TiledMap, i: number, j: number): number {
    return superposition[i][j].size;
}

/**
 * Among uncollapsed cells, pick one with the smallest entropy (fewest allowed variants). Uniform random tie-break among ties.
 * Returns `null` when every cell is collapsed, or when no uncollapsed cell has positive entropy (caller should use
 * {@link getGenerationStatus} first to distinguish contradiction from completion).
 *
 * @remarks Uses a full grid scan each call. For large maps, prefer {@link EntropyIndex} updated during propagation
 * (as `generateMap` does) to avoid scanning the whole grid every collapse.
 */
export function selectMinEntropyCell(
    w: number,
    h: number,
    tilemap: TiledMap,
    superposition: SuperpositionMap
): [number, number] | null {
    let minEntropy = Infinity;
    const ties: Array<[number, number]> = [];
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            if (tilemap[i][j] !== undefined) {
                continue;
            }
            const n = getEntropy(superposition, tilemap, i, j);
            if (n === 0) {
                continue;
            }
            if (n < minEntropy) {
                minEntropy = n;
                ties.length = 0;
                ties.push([i, j]);
            } else if (n === minEntropy) {
                ties.push([i, j]);
            }
        }
    }
    if (ties.length === 0) {
        return null;
    }
    return ties[Math.floor(Math.random() * ties.length)]!;
}

/** @alias {@link selectMinEntropyCell} */
export const selectNextCell = selectMinEntropyCell;

/**
 * Collapse `(x,y)` with weighted random choice over variants still in the superposition (weights from `TileDefinition`).
 * @returns The placed {@link TileInstance}
 */
export function collapseCellAt(
    x: number,
    y: number,
    tilemap: TiledMap,
    superposition: SuperpositionMap,
    availableTilesWithRotations: readonly TileVariant[]
): TileInstance {
    const weighted = getAllowedVariantsForCell(x, y, superposition, availableTilesWithRotations);
    if (weighted.length === 0) {
        throw new Error(
            formatWfcContradictionMessage(x, y, 'collapse was requested but no allowed variants remain in this cell.')
        );
    }
    const choice = getRandomTile(weighted);
    const instance: TileInstance = { id: choice.id, rotation: choice.rotation };
    tilemap[x][y] = instance;
    superposition[x][y] = new Set();
    return instance;
}

/**
 * Same as {@link collapseCellAt} but returns void (convenience for call sites that ignore the pick).
 */
export function collapseCell(
    x: number,
    y: number,
    tilemap: TiledMap,
    superposition: SuperpositionMap,
    availableTilesWithRotations: readonly TileVariant[]
): void {
    collapseCellAt(x, y, tilemap, superposition, availableTilesWithRotations);
}


/**
 * @interface TileDefinition
 * @description The definition of a tile, what you use to describe the tileset and the rules of placement
 */
export interface TileDefinition {
    /**
     * @property id
     * @description The unique identifier of the tile, should be identical to the key in the Map object of the tileset and is the value in the returned map
     */
    id: string;
    /**
     * @property weight
     * @description The weight of the tile (Higher weight means higher chance of being selected)
     */
    weight: number;
    /**
     * Whether this tile variant may neighbor another on the shared side.
     * @param edge This tile’s **local** edge (after {@link gridEdgeToLocalEdge}) that faces the neighbor.
     * @param self This tile instance (`id` and `rotation`); same variant as in the definition’s `id`.
     * @param neighbor The neighboring tile instance.
     * @param neighborEdge The neighbor’s **local** edge that faces this tile.
     */
    tileAllowed(edge: number, self: TileInstance, neighbor: TileInstance, neighborEdge: number): boolean;
    edgeAllowed(edge: number): boolean;
    rotationAllowed(rotation: number): boolean;
}

// utility function to get a random tile from a list of weighted tiles
function getRandomTile<T extends WeightedItem>(weightedTiles: Array<T>): T {
    const totalWeight = weightedTiles.reduce((sum, item) => sum + item.weight, 0);
    const random = Math.random() * totalWeight;
    let cumulativeWeight = 0;
    for (const tile of weightedTiles) {
        cumulativeWeight += tile.weight;
        if (random < cumulativeWeight) {
            return tile;
        }
    }
    return weightedTiles[weightedTiles.length - 1];
}

interface WeightedItem {
    weight: number;
}

/**
 * @interface TileInstance
 * @description The definition of a tile instance, that can be placed on a map, the combination of id and rotation should be unique.
 */
export interface TileInstance {
    id: string;
    rotation: number;
}

export interface TileVariant extends WeightedItem, TileInstance {
}

/**
 * @type TiledMap
 * @description a sparse (undefined cells are okay) matrix of TileInstance
 */
export type TiledMap = Array<Array<TileInstance | undefined>>;

export function encodeVariantKey(id: string, rotation: number): string {
    return JSON.stringify([id, rotation] as const);
}

export function decodeVariantKey(key: string): TileInstance {
    const parsed: unknown = JSON.parse(key);
    if (
        !Array.isArray(parsed) ||
        parsed.length !== 2 ||
        typeof parsed[0] !== 'string' ||
        typeof parsed[1] !== 'number'
    ) {
        throw new Error(`Invalid variant key: ${key}`);
    }
    return { id: parsed[0], rotation: parsed[1] };
}

export function createFullVariantKeySet(variants: readonly TileVariant[]): Set<string> {
    return new Set(variants.map((v) => encodeVariantKey(v.id, v.rotation)));
}

export function getOptionCount(superposition: SuperpositionMap, x: number, y: number): number {
    return superposition[x][y].size;
}

export function removeVariant(
    superposition: SuperpositionMap,
    x: number,
    y: number,
    id: string,
    rotation: number
): boolean {
    return superposition[x][y].delete(encodeVariantKey(id, rotation));
}

export function isCollapsed(tilemap: TiledMap, x: number, y: number): boolean {
    return tilemap[x][y] !== undefined;
}

export function getAllowedVariants(superposition: SuperpositionMap, x: number, y: number): TileInstance[] {
    return Array.from(superposition[x][y], decodeVariantKey);
}

/**
 * Allowed `(id, rotation)` variants at `(i,j)` with weights from the tileset catalog (same objects as seed / first-tile selection).
 */
export function getAllowedVariantsForCell(
    i: number,
    j: number,
    superposition: SuperpositionMap,
    availableTilesWithRotations: readonly TileVariant[]
): TileVariant[] {
    const keys = superposition[i][j];
    return availableTilesWithRotations.filter((v) => keys.has(encodeVariantKey(v.id, v.rotation)));
}

function tileVariantFromKey(key: string, tileset: Map<string, TileDefinition>): TileVariant {
    const { id, rotation } = decodeVariantKey(key);
    const def = tileset.get(id);
    if (!def) {
        throw new Error(`Unknown tile id in superposition: ${id}`);
    }
    return { id, rotation, weight: def.weight };
}

function buildAvailableTilesWithRotations(tileset: Map<string, TileDefinition>, tileType: TileType): TileVariant[] {
    for (const tile of tileset.values()) {
        if (!Number.isFinite(tile.weight) || tile.weight <= 0) {
            throw new Error(`Tile "${tile.id}" must have a finite weight > 0 (got ${tile.weight})`);
        }
    }
    return Array.from(tileset.values())
        .flatMap((tile) =>
            tileType.rotations
                .map((rotation) => {
                    if (tile.rotationAllowed(rotation)) {
                        return { id: tile.id, rotation, weight: tile.weight } satisfies TileVariant;
                    }
                    return null;
                })
                .filter((t): t is TileVariant => t !== null)
        );
}

export function initializeWfcMaps(
    w: number,
    h: number,
    tileset: Map<string, TileDefinition>,
    tileType: TileType = SquareTilePositions,
    seed?: TiledMap
): {
    tilemap: TiledMap;
    superposition: SuperpositionMap;
    availableTilesWithRotations: TileVariant[];
    /** Collapsed cells from seed or first random placement (propagation seeds for the first pass). */
    initCollapsedCells: Array<[number, number]>;
} {
    const availableTilesWithRotations = buildAvailableTilesWithRotations(tileset, tileType);
    const fullKeys = createFullVariantKeySet(availableTilesWithRotations);
    const superposition: SuperpositionMap = Array.from({ length: w }, () =>
        Array.from({ length: h }, () => new Set(fullKeys))
    );
    const tilemap: TiledMap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined));
    const initCollapsedCells: Array<[number, number]> = [];

    if (seed) {
        if (seed.length !== w || seed[0].length !== h) {
            throw new Error('Seed must be the same size as the map');
        }
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                const seedTile = seed[i][j];
                if (seedTile) {
                    const tile = tileset.get(seedTile.id);
                    if (!tile) {
                        throw new Error(
                            `Seed contains an invalid tile: ${seedTile.id} in position ${i}, ${j} does not exist in the tileset`
                        );
                    }
                    if (!tile.rotationAllowed(seedTile.rotation)) {
                        throw new Error(
                            `Seed contains an invalid tile rotation: ${seedTile.rotation} is not allowed for tile ${seedTile.id} in position ${i}, ${j}`
                        );
                    }
                    tilemap[i][j] = seedTile;
                    superposition[i][j] = new Set();
                    initCollapsedCells.push([i, j]);
                }
            }
        }
        return { tilemap, superposition, availableTilesWithRotations, initCollapsedCells };
    }

    const [x, y] = pickInitialCell(w, h);
    const tile = getRandomTile(availableTilesWithRotations);
    tilemap[x][y] = { id: tile.id, rotation: tile.rotation };
    superposition[x][y] = new Set();
    initCollapsedCells.push([x, y]);
    return { tilemap, superposition, availableTilesWithRotations, initCollapsedCells };
}

export default function generateMap(w: number, h: number, tileset: Map<string, TileDefinition>, tileType: TileType = SquareTilePositions, seed?: TiledMap): TiledMap {
    // short circuit if the tileset is empty
    if (tileset.size === 0) {
        return [];
    }

    // short circuit if width or height is 0
    if (w === 0 || h === 0) {
        return [];
    }

    const { tilemap, superposition, availableTilesWithRotations, initCollapsedCells } = initializeWfcMaps(
        w,
        h,
        tileset,
        tileType,
        seed
    );
    let changedCells = [...initCollapsedCells];

    const variantCount = availableTilesWithRotations.length;
    const entropyIndex = new EntropyIndex(w, h, tilemap, superposition, variantCount);
    const maxOuterIterations = w * h * Math.max(8, variantCount) * 10;
    let outerIterations = 0;
    const uncollapsedPool: Array<[number, number]> = [];
    const uncollapsedPoolIndex = new Map<string, number>();
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            if (tilemap[i][j] === undefined) {
                uncollapsedPoolIndex.set(cellKey(i, j), uncollapsedPool.length);
                uncollapsedPool.push([i, j]);
            }
        }
    }
    const removeUncollapsedFromPool = (x: number, y: number): void => {
        const k = cellKey(x, y);
        const idx = uncollapsedPoolIndex.get(k);
        if (idx === undefined) {
            return;
        }
        const last = uncollapsedPool[uncollapsedPool.length - 1]!;
        if (idx !== uncollapsedPool.length - 1) {
            uncollapsedPool[idx] = last;
            uncollapsedPoolIndex.set(cellKey(last[0], last[1]), idx);
        }
        uncollapsedPool.pop();
        uncollapsedPoolIndex.delete(k);
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (++outerIterations > maxOuterIterations) {
            throw new Error(
                'generateMap exceeded its iteration limit (possible bug or pathological constraints). ' +
                    WFC_CONTRADICTION_HINT
            );
        }

        const propagationSeeds = changedCells.slice();
        changedCells.length = 0;
        const compatibilityCache = new Map<string, boolean>();
        runPropagation(w, h, tileType, tileset, tilemap, superposition, propagationSeeds, {
            entropyIndex,
            compatibilityCache,
        });

        if (uncollapsedPool.length === 0) {
            return tilemap;
        }

        let next: [number, number];
        if (entropyIndex.getMinEntropy() === variantCount) {
            next = uncollapsedPool[Math.floor(Math.random() * uncollapsedPool.length)]!;
        } else {
            const picked = entropyIndex.pickMinEntropyCell(tilemap, superposition);
            if (picked === null) {
                throw new Error(
                    'generateMap: map is incomplete but no cell was eligible for collapse (internal state error).'
                );
            }
            next = picked;
        }

        const [cx, cy] = next;
        const prevOptions = superposition[cx][cy].size;
        collapseCell(cx, cy, tilemap, superposition, availableTilesWithRotations);
        removeUncollapsedFromPool(cx, cy);
        entropyIndex.noteCollapsed(cx, cy, prevOptions);
        changedCells.push(next);
    }
}
