
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
 * @description The definition of a hexagon (has 6 edges) tile, that can be rotated 60 degrees.
 */
export const HexagonTilePositions: TileType = {
    edges: 6, // clockwise 1 - top-right, 2 - right, 3 - bottom-right, 4 - bottom-left, 5 - left, 6 - top-left
    rotations: [0, 60, 120, 180, 240, 300],
    getEdgePosition(x: number, y: number, edge: number): [number, number] {
        switch (edge) {
            case 1:
                return [x, y - 1];
            case 2:
                return [x + 1, y];
            case 3:
                return [x, y + 1];
            case 4:
                return [x - 1, y + 1];
            case 5:
                return [x - 1, y];
            case 6:
                return [x - 1, y - 1];
        }
        throw new Error('Invalid edge');
    }
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
     * @method canBeNextTo
     * @param edge The edge of the tile to test against (based on the tileType, square has 4 edges, hexagon has 6, counting clockwise from top)
     * @param test The tile instance (id, position) to test against
     * @returns Whether the tile can be next to the test tile
     */
    tileAllowed(edge: number, test: TileInstance): boolean;
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

export default function generateMap(w: number, h: number, tileset: Map<string, TileDefinition>, tileType: TileType = SquareTilePositions, seed?: TiledMap): TiledMap {
    // short circuit if the tileset is empty
    if (tileset.size === 0) {
        return [];
    }

    // short circuit if width or height is 0
    if (w === 0 || h === 0) {
        return [];
    }

    const availableTilesWithRotations: Array<TileVariant> = Array.from(tileset.values()).map((tile) => {
        return tileType.rotations.map((rotation) => {
            if (tile.rotationAllowed(rotation)) {
                return {
                    id: tile.id,
                    rotation,
                    weight: tile.weight
                }
            } else {
                return null;
            }
        }).filter((tile) => tile !== null)
    }).flat();

    // initialize the options (uncollapsed) map with the number of available tiles in each cell, which is the total number of available tiles at this point
    const defaultValue = availableTilesWithRotations.length;
    const optionsmap: Array<Array<number>> = Array.from({ length: w }, () => Array.from({ length: h }, () => defaultValue));

    // initialize the tilemap with no tiles
    const tilemap: Array<Array<TileInstance | undefined>> = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined));

    // if there is a seed, use it
    let tilemapChanged = false;
    const changedCells: Array<[number, number]> = [];
    if (seed) {
        if (seed.length !== w || seed[0].length !== h) {
            throw new Error('Seed must be the same size as the map');
        }
        for (let i = 0; i < w; i++) {
            for (let j = 0; j < h; j++) {
                let seedTile = seed[i][j];
                if (seedTile) {
                    let tile = tileset.get(seedTile.id);
                    if (!tile) {
                        throw new Error(`Seed contains an invalid tile: ${seedTile.id} in position ${i}, ${j} does not exist in the tileset`);
                    }
                    if (!tile.rotationAllowed(seedTile.rotation)) {
                        throw new Error(`Seed contains an invalid tile rotation: ${seedTile.rotation} is not allowed for tile ${seedTile.id} in position ${i}, ${j}`);
                    }
                    tilemap[i][j] = seedTile;
                    optionsmap[i][j] = 0;
                    changedCells.push([i, j]);
                    tilemapChanged = true;
                }
            }
        }
    }

    // there was no seed, so we place a random tile, not near the edge, and update the options map
    if (!tilemapChanged) {
        // not near the edge
        const x = Math.floor(Math.random() * (w - 2)) + 1;
        const y = Math.floor(Math.random() * (h - 2)) + 1;

        // pick a random tile
        const tile = getRandomTile(availableTilesWithRotations);

        tilemap[x][y] = { id: tile.id, rotation: tile.rotation };
        optionsmap[x][y] = 0;
        changedCells.push([x, y]);
        tilemapChanged = true;
    }

    let iteration = 0;
    while (tilemapChanged) {
        tilemapChanged = false;
        iteration++;
        // update the options map, start with tiles that changed (value is [0, true])
        for (const [x, y] of changedCells) {
            tiletype.rotations.forEach((rotation) => {
                optionsmap[x][y] =
            })
        }
        changedCells = [];
        // find smallest options cells, that are not 0 (if there are none, break)

        // from the smallest options cells, pick a random cell

        // for that cell, find all the tiles that can be placed there

        // out of those tiles, pick a random tile

        // place the tile in the chosen cell, mark options as [0, true] and tilemapChanged to true

    }


    return tilemap;
}
