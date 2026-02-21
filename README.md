# Cookie's Flexible Weighted Wave Function Collapse (cfwwfc)

This repository contains an implementation of the Wave Function Collapse algorithm, a procedural generation algorithm that creates new data based on a provided set of examples. This implementation is flexible and allows for weighted tile selection, enabling more control over the generated output.

## What is Wave Function Collapse?

Wave Function Collapse (WFC) is a constraint-propagation algorithm used for procedural generation. It works by breaking down an input example (like an image or a set of rules) into smaller, overlapping units. The algorithm then uses these units to generate new data that is locally similar to the input, but can also produce novel and complex results.

In essence, WFC maintains a superposition of all possible states for each unit (e.g., each tile on a map). It iteratively reduces these possibilities based on adjacency rules until a single, consistent state is determined for each unit, resulting in a generated output.

## How to Use the Code to Generate a Map

The `generateMap` function in `index.ts` is the core of this implementation. Here's how you can use it:

1.  **Define Your Tileset:**
    You need to define your tiles and their properties in a `Map<string, TileDefinition>`. Each `TileDefinition` should include:
    *   `id`: A unique identifier for the tile.
    *   `weight`: A number indicating the probability of this tile being chosen (higher weight means higher probability).
    *   `tileAllowed`: A function that defines the adjacency rules. It takes an `edge` number and a `TileInstance` to test against, returning `true` if the tiles can be placed next to each other.
    *   `edgeAllowed`: A function that defines which edges of a tile are valid.
    *   `rotationAllowed`: A function that defines which rotations are valid for a tile.

2.  **Choose a Tile Type:**
    You can use `SquareTilePositions` (default) or `HexagonTilePositions` depending on your map's grid.

3.  **Call `generateMap`:**
    The function takes the desired width (`w`), height (`h`), your `tileset`, and optionally a `tileType` and a `seed` map.

    ```typescript
    import generateMap, { SquareTilePositions, TileDefinition, TileInstance, TileType } from 'cfwwfc';

    // Example Tileset Definition (for a simple 2x2 square grid)
    const myTileset: Map<string, TileDefinition> = new Map([
        ['empty', {
            id: 'empty',
            weight: 1,
            tileAllowed: (edge: number, test: TileInstance): boolean => {
                // All edges of 'empty' can connect to anything
                return true;
            },
            edgeAllowed: (edge: number): boolean => {
                // All edges are allowed for 'empty'
                return true;
            },
            rotationAllowed: (rotation: number): boolean => {
                // All rotations are allowed for 'empty'
                return true;
            }
        }],
        ['wall', {
            id: 'wall',
            weight: 5, // Higher weight for walls
            tileAllowed: (edge: number, test: TileInstance): boolean => {
                // Walls can only connect to other walls or empty space
                return test.id === 'wall' || test.id === 'empty';
            },
            edgeAllowed: (edge: number): boolean => {
                // All edges of 'wall' are allowed
                return true;
            },
            rotationAllowed: (rotation: number): boolean => {
                // All rotations are allowed for 'wall'
                return true;
            }
        }]
    ]);

    const mapWidth = 4;
    const mapHeight = 4;

    // TODO: Seed the map if Needed
    const seed: TiledMap = [];
  
    // Generate a map with square tiles
    const generatedMap = generateMap(mapWidth, mapHeight, myTileset, SquareTilePositions, seed);

    console.log(generatedMap);
    ```

## Current Progress of Development

*   **Core Algorithm:** The basic Wave Function Collapse algorithm is implemented, including weighted tile selection and rotation handling.
*   **Tile Definitions:** Structures for defining tile types (`SquareTilePositions`, `HexagonTilePositions`) and tile rules (`TileDefinition`) are in place.
*   **Map Generation:** The `generateMap` function handles initialization, constraint propagation, and tile placement.
*   **Seeding:** The ability to provide a seed map for consistent or partially pre-defined generation is included.
*   **Improvements Needed:**
    *   The `optionsmap` update logic within the `while` loop appears incomplete. It needs to correctly update the number of available options for neighboring cells based on the newly placed tile.
    *   The logic for selecting the cell with the minimum entropy (fewest options) and then picking a random valid tile needs to be fully implemented.
    *   Error handling could be more robust.
    *   Consider adding support for different tile shapes beyond squares and hexagons.
    *   Performance optimizations for large maps.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

[MIT] (You should specify your license here)
