# Cookie's Flexible Weighted Wave Function Collapse (cfwwfc)

This repository contains an implementation of the Wave Function Collapse algorithm, a procedural generation algorithm that creates new data based on a provided set of examples. This implementation is flexible and allows for weighted tile selection, enabling more control over the generated output.

## What is Wave Function Collapse?

Wave Function Collapse (WFC) is a constraint-propagation algorithm used for procedural generation. It works by breaking down an input example (like an image or a set of rules) into smaller, overlapping units. The algorithm then uses these units to generate new data that is locally similar to the input, but can also produce novel and complex results.

In essence, WFC maintains a superposition of all possible states for each unit (e.g., each tile on a map). It iteratively reduces these possibilities based on adjacency rules until a single, consistent state is determined for each unit, resulting in a generated output.

## Installation

From a checkout of this repository:

```bash
npm install
npm run build
```

Then import from the package entry (`dist/index.js` after build) or point your bundler at `index.ts`. If the package is published to npm, install with `npm install cfwwfc`.

## How to Use the Code to Generate a Map

The `generateMap` function in `index.ts` is the core of this implementation. Here's how you can use it:

1.  **Define Your Tileset:**
    You need to define your tiles and their properties in a `Map<string, TileDefinition>`. Each `TileDefinition` should include:
    *   `id`: A unique identifier for the tile.
    *   `weight`: A positive number used for weighted random choice among remaining variants (higher weight means higher probability).
    *   `tileAllowed`: Defines adjacency on the shared side. It receives this tile’s **local** `edge` (after rotation), this tile as `self` (`TileInstance`, so you can read `self.rotation`), the `neighbor` instance, and the neighbor’s **local** edge that faces `self`. Return `true` if those two variants may touch.
    *   `edgeAllowed`: A function that defines which edges of a tile are valid.
    *   `rotationAllowed`: A function that defines which rotations are valid for a tile.

2.  **Choose a Tile Type:**
    You can use `SquareTilePositions` (default), `HexagonTilePositions`, or `TriangleTilePositions` depending on your map’s topology. Triangles use the same `w × h` matrix: cell `(x,y)` is up-pointing when `(x+y)` is even and down-pointing when odd; see the doc comment on `TriangleTilePositions` in `index.ts` for edge numbering.

3.  **Call `generateMap`:**
    The function takes the desired width (`w`), height (`h`), your `tileset`, and optionally a `tileType` and a `seed` map (`TiledMap`: same dimensions as the output, `undefined` where the cell is not fixed).

    ```typescript
    import generateMap, {
        SquareTilePositions,
        type TileDefinition,
        type TileInstance,
        type TiledMap,
    } from 'cfwwfc';

    // Example tileset (for a simple grid)
    const myTileset: Map<string, TileDefinition> = new Map([
        ['empty', {
            id: 'empty',
            weight: 1,
            tileAllowed: (_e, _self, _n, _ne): boolean => true,
            edgeAllowed: (): boolean => true,
            rotationAllowed: (): boolean => true,
        }],
        ['wall', {
            id: 'wall',
            weight: 5,
            tileAllowed: (_edge, _self, neighbor, _ne): boolean =>
                neighbor.id === 'wall' || neighbor.id === 'empty',
            edgeAllowed: (): boolean => true,
            rotationAllowed: (): boolean => true,
        }],
    ]);

    const mapWidth = 4;
    const mapHeight = 4;

    // No seed: first tile is placed (interior on maps ≥3×3), then full WFC
    const generatedMap = generateMap(mapWidth, mapHeight, myTileset, SquareTilePositions);

    console.log(generatedMap);
    ```

### Seeding (optional)

If you pass a `seed`, it must be a `w × h` matrix. Use `undefined` for cells the algorithm should fill; only specified cells are fixed up front.

```typescript
const seed: TiledMap = Array.from({ length: mapWidth }, () =>
    Array.from({ length: mapHeight }, () => undefined)
);
seed[0][0] = { id: 'wall', rotation: 0 };

const withCorners = generateMap(mapWidth, mapHeight, myTileset, SquareTilePositions, seed);
```

## Behavior

`generateMap` initializes superpositions, runs constraint propagation from collapsed cells, then repeatedly picks a **minimum-entropy** cell, collapses it (weighted choice over remaining variants), and propagates until every cell has a tile.

- **Success:** When all cells are collapsed, the function returns the `TiledMap`.
- **Contradiction:** If any uncollapsed cell ends up with zero allowed variants, generation throws an `Error`. The message includes grid coordinates and `WFC_CONTRADICTION_HINT`. This version does **not** backtrack; relax rules, resize the map, or wrap the call in your own retry loop if needed.
- **Safety cap:** If the outer loop exceeds an internal iteration limit, an error is thrown so generation cannot spin forever.
- **Map size:** `w` and `h` must be positive integers. Empty tileset or zero width/height returns `[]`. Sizes such as `1×1` are supported when the tileset is valid (positive weights, at least one allowed rotation per tile you rely on).
- **First tile (no seed):** On maps with both dimensions at least 3, the first collapsed cell is chosen uniformly from the **interior** (not on the border). Smaller maps use a defined in-bounds policy (see `pickInitialCell` in the source).
- **Determinism:** Generation uses `Math.random()` for tie-breaking and weighted picks; two runs with the same inputs are not guaranteed to match unless you control randomness yourself.

## API overview

The module also exports helpers used by the algorithm and tests, including for example:

- Grid / compatibility: `SquareTilePositions`, `HexagonTilePositions`, `TriangleTilePositions`, `gridEdgeToLocalEdge`, `gridEdgeFromLocalEdge`, `variantsCompatible`, `propagateFrom`, `runPropagation`
- Superposition: `SuperpositionMap`, `encodeVariantKey`, `getOptionCount`, `initializeWfcMaps`
- Collapse / entropy: `EntropyIndex`, `selectMinEntropyCell`, `collapseCell`, `collapseCellAt`, `pickInitialCell`
- Propagation options: `WfcPropagationOptions` (`entropyIndex`, `compatibilityCache`, `forceCollapse`) for custom callers of `runPropagation` / `propagateFrom`
- Status: `getGenerationStatus`, `WFC_CONTRADICTION_HINT`, `formatWfcContradictionMessage`

See `index.ts` for the full public surface.

## Performance

`generateMap` keeps an `EntropyIndex` bucket map of uncollapsed cell entropies (updated during propagation) so each collapse step does not scan the whole grid. Propagation also memoizes variant-pair compatibility checks for that pass. For rough timings on large trivial maps, run `npm run benchmark` (builds then runs `scripts/benchmark.mjs`).

On my a MacBook Pro M2 Max I got the following:


| size    | type   | count  | simple?         | time      |
| ------- | ------ | ------ | --------------- | --------- |
| 32×32   | square | 1024   | trivial tileset | 15.0 ms   |
| 64×64   | square | 4096   | trivial tileset | 46.8 ms   |
| 128×128 | square | 16384  | trivial tileset | 177.7 ms  |
| 256×256 | square | 65536  | trivial tileset | 731.3 ms  |
| 512×512 | square | 262144 | trivial tileset | 3082.9 ms |

Based on the above - if you're generating big maps (>10K count) in real-time - for better user experience I suggest passing the newTile callback option - so your client won't have to wait for the entire map to genenrate before proceeding and can get a "stream" of the tiles.

## Limitations and possible extensions

- **No backtracking:** Contradictions fail fast; automatic retry or AC-4-style recovery is left to the caller.
- **Tile shapes:** Square, hex, and triangle tilings ship as `TileType` values; other topologies need a new `TileType` (`edges`, `rotations`, `getEdgePosition`) and tests that `getOppositeEdge` round-trips on your coordinates.
- **Performance:** Custom workflows using `runPropagation` without `generateMap` can pass `entropyIndex` and `compatibilityCache` via `WfcPropagationOptions` if you maintain them when you change superpositions yourself.

## Contributing

Contributions are welcome. Please open issues or pull requests.

## License

This project is licensed under the [MIT License](LICENSE).
