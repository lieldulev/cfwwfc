import { describe, expect, it } from 'vitest';
import generateMap, {
    SquareTilePositions,
    type TileDefinition,
    type TileInstance,
    type TiledMap,
} from '../index';

/**
 * Mirrors the README usage snippets. If this fails, update the README or restore API compatibility.
 */
describe('README example smoke', () => {
    const myTileset = (): Map<string, TileDefinition> =>
        new Map([
            [
                'empty',
                {
                    id: 'empty',
                    weight: 1,
                    tileAllowed: (_e: number, _s: TileInstance, _n: TileInstance, _ne: number): boolean => true,
                    edgeAllowed: (): boolean => true,
                    rotationAllowed: (): boolean => true,
                },
            ],
            [
                'wall',
                {
                    id: 'wall',
                    weight: 5,
                    tileAllowed: (
                        _edge: number,
                        _self: TileInstance,
                        neighbor: TileInstance,
                        _neighborEdge: number
                    ): boolean => neighbor.id === 'wall' || neighbor.id === 'empty',
                    edgeAllowed: (): boolean => true,
                    rotationAllowed: (): boolean => true,
                },
            ],
        ]);

    it('generates a 4×4 map without a seed', () => {
        const mapWidth = 4;
        const mapHeight = 4;
        const generatedMap = generateMap(mapWidth, mapHeight, myTileset(), SquareTilePositions);

        expect(generatedMap.length).toBe(4);
        expect(generatedMap[0].length).toBe(4);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                expect(generatedMap[i][j]).toBeDefined();
            }
        }
    });

    it('accepts the documented optional seed shape', () => {
        const mapWidth = 4;
        const mapHeight = 4;
        const seed: TiledMap = Array.from({ length: mapWidth }, () =>
            Array.from({ length: mapHeight }, () => undefined)
        );
        seed[0][0] = { id: 'wall', rotation: 0 };

        const m = generateMap(mapWidth, mapHeight, myTileset(), SquareTilePositions, seed);
        expect(m[0][0]).toEqual({ id: 'wall', rotation: 0 });
    });
});
