import { describe, expect, it, vi } from 'vitest';
import generateMap, {
    collapseCell,
    collapseCellAt,
    createFullVariantKeySet,
    decodeVariantKey,
    encodeVariantKey,
    EntropyIndex,
    getAllowedVariants,
    getAllowedVariantsForCell,
    getEntropy,
    getGenerationStatus,
    getOppositeEdge,
    getOptionCount,
    gridEdgeToLocalEdge,
    HexagonTilePositions,
    initializeWfcMaps,
    isCollapsed,
    pickInitialCell,
    propagateFrom,
    selectMinEntropyCell,
    selectNextCell,
    SquareTilePositions,
    TriangleTilePositions,
    WFC_CONTRADICTION_HINT,
    type SuperpositionMap,
    type TileDefinition,
    type TileInstance,
    type TileType,
    type TiledMap,
    type TileVariant,
    variantsCompatible,
    gridEdgeFromLocalEdge,
} from './index';

function trivialTile(id: string, weight = 1): TileDefinition {
    return {
        id,
        weight,
        tileAllowed(_e: number, _self: TileInstance, _n: TileInstance, _ne: number): boolean {
            return true;
        },
        edgeAllowed(): boolean {
            return true;
        },
        rotationAllowed(): boolean {
            return true;
        },
    };
}

function restrictiveRotationTile(id: string): TileDefinition {
    return {
        id,
        weight: 1,
        tileAllowed(_e: number, _self: TileInstance, _n: TileInstance, _ne: number): boolean {
            return true;
        },
        edgeAllowed(): boolean {
            return true;
        },
        rotationAllowed(rotation: number): boolean {
            return rotation === 0;
        },
    };
}

function assertOppositeRoundTrip(tileType: TileType, x: number, y: number, edge: number): void {
    const [nx, ny] = tileType.getEdgePosition(x, y, edge);
    const back = getOppositeEdge(tileType, x, y, edge);
    const [bx, by] = tileType.getEdgePosition(nx, ny, back);
    expect([bx, by]).toEqual([x, y]);
}

function assertAllEdgesOppositeConsistent(tileType: TileType, x0: number, y0: number, radius: number): void {
    for (let x = x0 - radius; x <= x0 + radius; x++) {
        for (let y = y0 - radius; y <= y0 + radius; y++) {
            for (let e = 1; e <= tileType.edges; e++) {
                assertOppositeRoundTrip(tileType, x, y, e);
            }
        }
    }
}

describe('getEdgePosition / getOppositeEdge consistency', () => {
    const shapes: Array<{ name: string; type: TileType }> = [
        { name: 'square', type: SquareTilePositions },
        { name: 'hex', type: HexagonTilePositions },
        { name: 'triangle', type: TriangleTilePositions },
    ];

    it.each(shapes)('$name: neighbor is distinct for each edge at a fixed cell', ({ type }) => {
        const x = 3;
        const y = 3;
        const seen = new Set<string>();
        for (let e = 1; e <= type.edges; e++) {
            const [nx, ny] = type.getEdgePosition(x, y, e);
            const k = `${nx},${ny}`;
            expect(seen.has(k)).toBe(false);
            seen.add(k);
        }
        expect(seen.size).toBe(type.edges);
    });

    it('square: round-trips for all four edges', () => {
        for (let e = 1; e <= 4; e++) {
            assertOppositeRoundTrip(SquareTilePositions, 2, 2, e);
        }
    });

    it('hex: round-trips for all six edges', () => {
        for (let e = 1; e <= 6; e++) {
            assertOppositeRoundTrip(HexagonTilePositions, 4, 4, e);
        }
    });

    it('triangle: round-trips for all three edges on up and down cells', () => {
        assertAllEdgesOppositeConsistent(TriangleTilePositions, 5, 5, 2);
    });
});

describe('gridEdgeToLocalEdge', () => {
    it('square: top edge cycles with 90° steps', () => {
        expect(gridEdgeToLocalEdge(SquareTilePositions, 1, 0)).toBe(1);
        expect(gridEdgeToLocalEdge(SquareTilePositions, 1, 90)).toBe(4);
        expect(gridEdgeToLocalEdge(SquareTilePositions, 1, 180)).toBe(3);
        expect(gridEdgeToLocalEdge(SquareTilePositions, 1, 270)).toBe(2);
    });

    it('square: gridEdgeFromLocalEdge inverts gridEdgeToLocalEdge', () => {
        for (let grid = 1; grid <= 4; grid++) {
            for (const rot of SquareTilePositions.rotations) {
                const local = gridEdgeToLocalEdge(SquareTilePositions, grid, rot);
                const back = gridEdgeFromLocalEdge(SquareTilePositions, local, rot);
                expect(back).toBe(grid);
            }
        }
    });

    it('triangle: edge 1 cycles with 120° steps', () => {
        expect(gridEdgeToLocalEdge(TriangleTilePositions, 1, 0)).toBe(1);
        expect(gridEdgeToLocalEdge(TriangleTilePositions, 1, 120)).toBe(3);
        expect(gridEdgeToLocalEdge(TriangleTilePositions, 1, 240)).toBe(2);
    });
});

describe('variantsCompatible', () => {
    it('returns false when tileset is missing a definition', () => {
        const tileset = new Map<string, TileDefinition>();
        const a: TileInstance = { id: 'a', rotation: 0 };
        const b: TileInstance = { id: 'b', rotation: 0 };
        expect(variantsCompatible(SquareTilePositions, tileset, a, b, 0, 0, 2)).toBe(false);
    });

    it('respects tileAllowed on both sides', () => {
        const defA: TileDefinition = {
            id: 'a',
            weight: 1,
            tileAllowed: (edge, _self, neighbor) => edge === 2 && neighbor.id === 'b',
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
        };
        const defB: TileDefinition = {
            id: 'b',
            weight: 1,
            tileAllowed: (edge, _self, neighbor) => edge === 4 && neighbor.id === 'a',
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
        };
        const tileset = new Map([
            ['a', defA],
            ['b', defB],
        ]);
        const a: TileInstance = { id: 'a', rotation: 0 };
        const b: TileInstance = { id: 'b', rotation: 0 };
        expect(variantsCompatible(SquareTilePositions, tileset, a, b, 0, 0, 2)).toBe(true);
        expect(variantsCompatible(SquareTilePositions, tileset, a, { id: 'b', rotation: 90 }, 0, 0, 2)).toBe(false);
    });
});

describe('encodeVariantKey / decodeVariantKey', () => {
    it('round-trips id and rotation', () => {
        const key = encodeVariantKey('grass', 90);
        expect(decodeVariantKey(key)).toEqual({ id: 'grass', rotation: 90 });
    });

    it('uses distinct keys for distinct variants', () => {
        expect(encodeVariantKey('a', 0)).not.toBe(encodeVariantKey('a', 90));
        expect(encodeVariantKey('a', 0)).not.toBe(encodeVariantKey('b', 0));
    });

    it('supports ids that contain delimiter-like characters', () => {
        const key = encodeVariantKey('tile|weird', 180);
        expect(decodeVariantKey(key)).toEqual({ id: 'tile|weird', rotation: 180 });
    });
});

describe('generateMap short-circuit', () => {
    it('returns [] for empty tileset', () => {
        expect(generateMap(3, 3, new Map())).toEqual([]);
    });

    it('returns [] when width or height is zero', () => {
        const tileset = new Map([['x', trivialTile('x')]]);
        expect(generateMap(0, 3, tileset)).toEqual([]);
        expect(generateMap(3, 0, tileset)).toEqual([]);
    });
});

function assertCellInBounds(xy: [number, number], w: number, h: number): void {
    const [x, y] = xy;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(w);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThan(h);
}

describe('pickInitialCell', () => {
    it('rejects non-positive or non-integer dimensions', () => {
        expect(() => pickInitialCell(0, 1)).toThrow(/positive integer dimensions/);
        expect(() => pickInitialCell(1, 0)).toThrow(/positive integer dimensions/);
        expect(() => pickInitialCell(2.2, 3)).toThrow(/positive integer dimensions/);
    });

    it('always returns in-bounds coordinates for small maps (many samples)', () => {
        const sizes: Array<[number, number]> = [
            [1, 1],
            [2, 2],
            [3, 1],
            [1, 3],
            [2, 1],
            [1, 2],
        ];
        for (const [w, h] of sizes) {
            for (let k = 0; k < 120; k++) {
                assertCellInBounds(pickInitialCell(w, h), w, h);
            }
        }
    });

    it('on 4×4 never places the first tile on the border', () => {
        for (let k = 0; k < 200; k++) {
            const [x, y] = pickInitialCell(4, 4);
            expect(x).toBeGreaterThanOrEqual(1);
            expect(x).toBeLessThanOrEqual(2);
            expect(y).toBeGreaterThanOrEqual(1);
            expect(y).toBeLessThanOrEqual(2);
        }
    });

    it('on 3×3 the only interior cell is (1,1)', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99);
        expect(pickInitialCell(3, 3)).toEqual([1, 1]);
        vi.restoreAllMocks();
    });
});

describe('generateMap integration', () => {
    it('completes a 3×3 map with a trivial permissive tileset', () => {
        const trivialTileset = new Map<string, TileDefinition>([['a', trivialTile('a')]]);
        const m = generateMap(3, 3, trivialTileset, SquareTilePositions);
        expect(m.length).toBe(3);
        expect(m[0].length).toBe(3);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                expect(m[i][j]).toBeDefined();
                expect(m[i][j]!.id).toBe('a');
            }
        }
    });

    it('completes a 3×3 triangle grid with a trivial permissive tileset', () => {
        const trivialTileset = new Map<string, TileDefinition>([['a', trivialTile('a')]]);
        const m = generateMap(3, 3, trivialTileset, TriangleTilePositions);
        expect(m.length).toBe(3);
        expect(m[0].length).toBe(3);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                expect(m[i][j]).toBeDefined();
                expect(m[i][j]!.id).toBe('a');
            }
        }
    });

    it('fills the map on multiple runs with a permissive tileset', () => {
        const tileset = new Map<string, TileDefinition>([
            ['a', trivialTile('a', 1)],
            ['b', trivialTile('b', 1)],
        ]);
        for (let run = 0; run < 5; run++) {
            const m = generateMap(4, 4, tileset, SquareTilePositions);
            expect(m.length).toBe(4);
            expect(m[0].length).toBe(4);
            for (let i = 0; i < 4; i++) {
                for (let j = 0; j < 4; j++) {
                    expect(m[i][j]).toBeDefined();
                }
            }
        }
    });

    it('uses an all-undefined seed like an empty map by placing a first tile', () => {
        const tileset = new Map([['solo', trivialTile('solo')]]);
        const emptySeed = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => undefined)) as Array<
            Array<{ id: string; rotation: number } | undefined>
        >;
        const m = generateMap(2, 2, tileset, SquareTilePositions, emptySeed);
        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 2; j++) {
                expect(m[i][j]).toEqual({ id: 'solo', rotation: expect.any(Number) });
            }
        }
    });

    it('completes a 1×1 map in one pass', () => {
        const tileset = new Map([['solo', trivialTile('solo')]]);
        const m = generateMap(1, 1, tileset, SquareTilePositions);
        expect(m[0][0]).toEqual({ id: 'solo', rotation: expect.any(Number) });
    });

    it('throws an actionable contradiction when no tile can neighbor another (2×1)', () => {
        const lonely: TileDefinition = {
            id: 'lonely',
            weight: 1,
            tileAllowed(_e: number, _self: TileInstance, _n: TileInstance, _ne: number): boolean {
                return false;
            },
            edgeAllowed() {
                return true;
            },
            rotationAllowed() {
                return true;
            },
        };
        const tileset = new Map([['lonely', lonely]]);
        let caught: unknown;
        try {
            generateMap(2, 1, tileset, SquareTilePositions);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        const msg = caught instanceof Error ? caught.message : String(caught);
        expect(msg).toMatch(/Wave function contradiction at \([01], 0\)/);
        expect(msg).toContain(WFC_CONTRADICTION_HINT);
    });
});

describe('getGenerationStatus', () => {
    it('reports complete when every cell is collapsed', () => {
        const w = 2;
        const h = 2;
        const tilemap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => ({ id: 'a', rotation: 0 }))
        ) as TiledMap;
        const superposition: SuperpositionMap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => new Set<string>())
        );
        expect(getGenerationStatus(w, h, tilemap, superposition)).toEqual({ kind: 'complete' });
    });

    it('reports contradiction when an uncollapsed cell has an empty superposition', () => {
        const w = 2;
        const h = 1;
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as TiledMap;
        tilemap[0][0] = { id: 'a', rotation: 0 };
        const superposition: SuperpositionMap = [
            [new Set()],
            [new Set()],
        ];
        expect(getGenerationStatus(w, h, tilemap, superposition)).toEqual({
            kind: 'contradiction',
            x: 1,
            y: 0,
        });
    });

    it('reports continue when some cell is uncollapsed with options', () => {
        const w = 2;
        const h = 1;
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as TiledMap;
        const superposition: SuperpositionMap = [
            [variantKeys(2)],
            [variantKeys(2)],
        ];
        expect(getGenerationStatus(w, h, tilemap, superposition)).toEqual({ kind: 'continue' });
    });
});

describe('superposition initialization (initializeWfcMaps)', () => {
    it('gives every uncollapsed cell the full variant set when multiple tiles and rotations apply', () => {
        const tileset = new Map<string, TileDefinition>([
            ['a', trivialTile('a')],
            ['b', trivialTile('b')],
        ]);
        const seed = Array.from({ length: 3 }, () =>
            Array.from({ length: 3 }, () => undefined)
        ) as Array<Array<{ id: string; rotation: number } | undefined>>;
        seed[1][1] = { id: 'a', rotation: 0 };
        const { superposition } = initializeWfcMaps(3, 3, tileset, SquareTilePositions, seed);
        const expected = 2 * SquareTilePositions.rotations.length;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                if (i === 1 && j === 1) {
                    expect(getOptionCount(superposition, i, j)).toBe(0);
                } else {
                    expect(getOptionCount(superposition, i, j)).toBe(expected);
                }
            }
        }
    });

    it('omits rotations disallowed by tile definitions', () => {
        const tileset = new Map<string, TileDefinition>([['only0', restrictiveRotationTile('only0')]]);
        const seed = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => undefined)) as Array<
            Array<{ id: string; rotation: number } | undefined>
        >;
        seed[1][1] = { id: 'only0', rotation: 0 };
        const { superposition } = initializeWfcMaps(2, 2, tileset, SquareTilePositions, seed);
        expect(getOptionCount(superposition, 0, 0)).toBe(1);
        expect(getAllowedVariants(superposition, 0, 0)).toEqual([{ id: 'only0', rotation: 0 }]);
    });
});

describe('seeded superposition', () => {
    it('collapses seeded cells in tilemap and clears superposition there', () => {
        const tileset = new Map<string, TileDefinition>([
            ['a', trivialTile('a')],
            ['b', trivialTile('b')],
        ]);
        const seed = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => undefined)) as Array<
            Array<{ id: string; rotation: number } | undefined>
        >;
        seed[0][1] = { id: 'b', rotation: 270 };

        const { tilemap, superposition } = initializeWfcMaps(2, 2, tileset, SquareTilePositions, seed);

        expect(isCollapsed(tilemap, 0, 1)).toBe(true);
        expect(tilemap[0][1]).toEqual({ id: 'b', rotation: 270 });
        expect(getOptionCount(superposition, 0, 1)).toBe(0);

        const fullCount = 2 * SquareTilePositions.rotations.length;
        expect(getOptionCount(superposition, 0, 0)).toBe(fullCount);
        expect(isCollapsed(tilemap, 0, 0)).toBe(false);
    });
});

describe('createFullVariantKeySet', () => {
    it('matches encodeVariantKey for each variant', () => {
        const variants: TileVariant[] = [
            { id: 'x', rotation: 0, weight: 1 },
            { id: 'x', rotation: 90, weight: 1 },
        ];
        const set = createFullVariantKeySet(variants);
        expect(set.size).toBe(2);
        expect(set.has(encodeVariantKey('x', 0))).toBe(true);
        expect(set.has(encodeVariantKey('x', 90))).toBe(true);
    });
});

function variantKeys(count: number, id = 't'): Set<string> {
    return new Set(Array.from({ length: count }, (_, k) => encodeVariantKey(id, k)));
}

describe('getEntropy', () => {
    it('matches superposition size at (i,j)', () => {
        const w = 2;
        const h = 2;
        const superposition: SuperpositionMap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => new Set<string>())
        );
        superposition[0][1] = variantKeys(7);
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as TiledMap;
        expect(getEntropy(superposition, tilemap, 0, 1)).toBe(7);
        expect(getEntropy(superposition, tilemap, 0, 0)).toBe(0);
    });
});

describe('selectMinEntropyCell', () => {
    it('never picks a cell with higher entropy when two cells tie at the minimum', () => {
        const w = 4;
        const h = 1;
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as TiledMap;
        tilemap[0][0] = { id: 'x', rotation: 0 };
        const superposition: SuperpositionMap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => new Set<string>())
        );
        superposition[0][0] = new Set();
        superposition[1][0] = variantKeys(5);
        superposition[2][0] = variantKeys(2);
        superposition[3][0] = variantKeys(2);

        for (let run = 0; run < 80; run++) {
            const next = selectMinEntropyCell(w, h, tilemap, superposition);
            expect(next).not.toBeNull();
            expect(next![0] === 2 || next![0] === 3).toBe(true);
            expect(next![1]).toBe(0);
        }
    });

    it('breaks ties uniformly at random among tied cells (fixed RNG)', () => {
        const w = 3;
        const h = 1;
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as TiledMap;
        const superposition: SuperpositionMap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => variantKeys(2))
        );

        const rnd = vi.spyOn(Math, 'random');
        rnd.mockReturnValue(0.2);
        expect(selectMinEntropyCell(w, h, tilemap, superposition)).toEqual([0, 0]);
        rnd.mockReturnValue(0.66);
        expect(selectMinEntropyCell(w, h, tilemap, superposition)).toEqual([1, 0]);
        rnd.mockReturnValue(0.95);
        expect(selectMinEntropyCell(w, h, tilemap, superposition)).toEqual([2, 0]);
        rnd.mockRestore();
    });

    it('returns null when every cell is collapsed', () => {
        const w = 2;
        const h = 2;
        const tilemap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => ({ id: 'a', rotation: 0 }))
        ) as TiledMap;
        const superposition: SuperpositionMap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => new Set<string>())
        );
        expect(selectMinEntropyCell(w, h, tilemap, superposition)).toBeNull();
    });

    it('returns the only uncollapsed cell when it alone has options', () => {
        const w = 2;
        const h = 1;
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as TiledMap;
        tilemap[0][0] = { id: 'a', rotation: 0 };
        const superposition: SuperpositionMap = [
            [new Set()],
            [variantKeys(4)],
        ];
        expect(selectMinEntropyCell(w, h, tilemap, superposition)).toEqual([1, 0]);
    });

    it('selectNextCell is an alias of selectMinEntropyCell', () => {
        expect(selectNextCell).toBe(selectMinEntropyCell);
    });

    it('EntropyIndex.pickMinEntropyCell agrees with selectMinEntropyCell when the minimum is unique', () => {
        const w = 3;
        const h = 3;
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as TiledMap;
        const full = new Set([encodeVariantKey('a', 0), encodeVariantKey('a', 90), encodeVariantKey('b', 0)]);
        const superposition: SuperpositionMap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => new Set(full))
        );
        superposition[2][2] = new Set([encodeVariantKey('a', 0)]);

        const maxEntropy = full.size;
        const idx = new EntropyIndex(w, h, tilemap, superposition, maxEntropy);
        expect(selectMinEntropyCell(w, h, tilemap, superposition)).toEqual([2, 2]);
        expect(idx.pickMinEntropyCell(tilemap, superposition)).toEqual([2, 2]);
    });
});

describe('getAllowedVariantsForCell', () => {
    it('returns catalog variants whose keys are still in the superposition', () => {
        const available: TileVariant[] = [
            { id: 'a', rotation: 0, weight: 1 },
            { id: 'a', rotation: 90, weight: 1 },
            { id: 'b', rotation: 0, weight: 2 },
        ];
        const superposition: SuperpositionMap = [
            [new Set([encodeVariantKey('a', 0), encodeVariantKey('b', 0)])],
        ];
        expect(getAllowedVariantsForCell(0, 0, superposition, available)).toEqual([
            { id: 'a', rotation: 0, weight: 1 },
            { id: 'b', rotation: 0, weight: 2 },
        ]);
    });
});

describe('collapseCellAt', () => {
    it('picks the heavy tile when cumulative random falls in its band (weights 1 vs 9)', () => {
        const available: TileVariant[] = [
            { id: 'A', rotation: 0, weight: 1 },
            { id: 'B', rotation: 0, weight: 9 },
        ];
        const keys = available.map((v) => encodeVariantKey(v.id, v.rotation));
        const superposition: SuperpositionMap = [[new Set(keys)]];
        const tilemap = [[undefined]] as TiledMap;
        vi.spyOn(Math, 'random').mockReturnValue(0.15);
        expect(collapseCellAt(0, 0, tilemap, superposition, available)).toEqual({ id: 'B', rotation: 0 });
        vi.restoreAllMocks();
    });

    it('picks the light tile when cumulative random falls in its band', () => {
        const available: TileVariant[] = [
            { id: 'A', rotation: 0, weight: 1 },
            { id: 'B', rotation: 0, weight: 9 },
        ];
        const keys = available.map((v) => encodeVariantKey(v.id, v.rotation));
        const superposition: SuperpositionMap = [[new Set(keys)]];
        const tilemap = [[undefined]] as TiledMap;
        vi.spyOn(Math, 'random').mockReturnValue(0.05);
        expect(collapseCellAt(0, 0, tilemap, superposition, available)).toEqual({ id: 'A', rotation: 0 });
        vi.restoreAllMocks();
    });

    it('with one remaining variant, always picks it regardless of RNG', () => {
        const available: TileVariant[] = [
            { id: 'a', rotation: 0, weight: 1 },
            { id: 'b', rotation: 0, weight: 99 },
        ];
        const superposition: SuperpositionMap = [[new Set([encodeVariantKey('a', 0)])]];
        const tilemap = [[undefined]] as TiledMap;
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        expect(collapseCellAt(0, 0, tilemap, superposition, available)).toEqual({ id: 'a', rotation: 0 });
        vi.restoreAllMocks();
    });

    it('never selects a rotation that is not in the catalog', () => {
        const available: TileVariant[] = [{ id: 't', rotation: 0, weight: 1 }];
        const superposition: SuperpositionMap = [[new Set([encodeVariantKey('t', 0)])]];
        const tilemap = [[undefined]] as TiledMap;
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(collapseCellAt(0, 0, tilemap, superposition, available).rotation).toBe(0);
        vi.restoreAllMocks();
    });

    it('throws when the superposition is empty', () => {
        const available: TileVariant[] = [{ id: 'x', rotation: 0, weight: 1 }];
        const superposition: SuperpositionMap = [[new Set()]];
        const tilemap = [[undefined]] as TiledMap;
        expect(() => collapseCellAt(0, 0, tilemap, superposition, available)).toThrow(/no allowed variants remain/);
    });
});

describe('tile weight validation', () => {
    it('rejects non-positive weights when building the variant catalog', () => {
        const bad = new Map<string, TileDefinition>([
            [
                'x',
                {
                    id: 'x',
                    weight: 0,
                    tileAllowed: (_e: number, _s: TileInstance, _n: TileInstance, _ne: number) => true,
                    edgeAllowed: () => true,
                    rotationAllowed: () => true,
                },
            ],
        ]);
        expect(() => generateMap(1, 1, bad)).toThrow(/finite weight > 0/);
    });
});

describe('selectNextCell / collapseCell', () => {
    it('selects minimum-entropy cells and collapseCell commits a weighted choice', () => {
        const w = 2;
        const h = 2;
        const variants: TileVariant[] = [
            { id: 'x', rotation: 0, weight: 1 },
            { id: 'x', rotation: 90, weight: 1 },
        ];
        const keys = variants.map((v) => encodeVariantKey(v.id, v.rotation));
        const superposition: SuperpositionMap = Array.from({ length: w }, () =>
            Array.from({ length: h }, () => new Set(keys))
        );
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as Array<
            Array<{ id: string; rotation: number } | undefined>
        >;

        const next = selectNextCell(w, h, tilemap, superposition);
        expect(next).not.toBeNull();
        collapseCell(next![0], next![1], tilemap, superposition, variants);
        expect(tilemap[next![0]][next![1]]).toBeDefined();
        expect(superposition[next![0]][next![1]].size).toBe(0);
    });
});

describe('propagateFrom', () => {
    it('permissive tileset does not shrink an uncollapsed neighbor', () => {
        const tileset = new Map<string, TileDefinition>([
            ['a', trivialTile('a')],
            ['b', trivialTile('b')],
        ]);
        const w = 2;
        const h = 1;
        const available: TileVariant[] = [];
        for (const t of tileset.values()) {
            for (const rot of SquareTilePositions.rotations) {
                if (t.rotationAllowed(rot)) {
                    available.push({ id: t.id, rotation: rot, weight: t.weight });
                }
            }
        }
        const keyList = available.map((v) => encodeVariantKey(v.id, v.rotation));
        const superposition: SuperpositionMap = [[new Set()], [new Set(keyList)]];
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as Array<
            Array<{ id: string; rotation: number } | undefined>
        >;

        tilemap[0][0] = { id: 'a', rotation: 0 };
        superposition[0][0] = new Set();
        propagateFrom(w, h, SquareTilePositions, tileset, tilemap, superposition, 0, 0);

        expect(superposition[1][0].size).toBe(available.length);
    });

    it('two-cell strip: collapsed A leaves only B on the right', () => {
        const a: TileDefinition = {
            id: 'a',
            weight: 1,
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
            tileAllowed: (edge, _self, neighbor) => edge === 2 && neighbor.id === 'b',
        };
        const b: TileDefinition = {
            id: 'b',
            weight: 1,
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
            tileAllowed: (edge, _self, neighbor) => edge === 4 && neighbor.id === 'a',
        };
        const c: TileDefinition = {
            id: 'c',
            weight: 1,
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
            tileAllowed(_e: number, _self: TileInstance, _n: TileInstance, _ne: number): boolean {
                return false;
            },
        };
        const tileset = new Map<string, TileDefinition>([
            ['a', a],
            ['b', b],
            ['c', c],
        ]);
        const w = 2;
        const h = 1;
        const available: TileVariant[] = [];
        for (const t of tileset.values()) {
            for (const rot of SquareTilePositions.rotations) {
                if (t.rotationAllowed(rot)) {
                    available.push({ id: t.id, rotation: rot, weight: t.weight });
                }
            }
        }
        const fullKeys = createFullVariantKeySet(available);
        const superposition: SuperpositionMap = [
            [new Set()],
            [new Set(fullKeys)],
        ];
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as Array<
            Array<{ id: string; rotation: number } | undefined>
        >;
        tilemap[0][0] = { id: 'a', rotation: 0 };

        propagateFrom(w, h, SquareTilePositions, tileset, tilemap, superposition, 0, 0, { forceCollapse: false });

        expect(Array.from(superposition[1][0]).sort()).toEqual([encodeVariantKey('b', 0)]);
    });

    it('forced collapse chain: narrowing one neighbor forces the next', () => {
        const a: TileDefinition = {
            id: 'a',
            weight: 1,
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
            tileAllowed: (edge, _self, neighbor) => (edge === 2 || edge === 4) && neighbor.id === 'b',
        };
        const b: TileDefinition = {
            id: 'b',
            weight: 1,
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
            tileAllowed: (edge, _self, neighbor) => (edge === 2 || edge === 4) && neighbor.id === 'a',
        };
        const c: TileDefinition = {
            id: 'c',
            weight: 1,
            edgeAllowed: () => true,
            rotationAllowed: (r) => r === 0,
            tileAllowed(_e: number, _self: TileInstance, _n: TileInstance, _ne: number): boolean {
                return false;
            },
        };
        const tileset = new Map<string, TileDefinition>([
            ['a', a],
            ['b', b],
            ['c', c],
        ]);
        const w = 3;
        const h = 1;
        const available: TileVariant[] = [];
        for (const t of tileset.values()) {
            for (const rot of SquareTilePositions.rotations) {
                if (t.rotationAllowed(rot)) {
                    available.push({ id: t.id, rotation: rot, weight: t.weight });
                }
            }
        }
        const fullKeys = createFullVariantKeySet(available);
        const superposition: SuperpositionMap = [[new Set()], [new Set(fullKeys)], [new Set(fullKeys)]];
        const tilemap = Array.from({ length: w }, () => Array.from({ length: h }, () => undefined)) as Array<
            Array<{ id: string; rotation: number } | undefined>
        >;
        tilemap[0][0] = { id: 'a', rotation: 0 };

        propagateFrom(w, h, SquareTilePositions, tileset, tilemap, superposition, 0, 0);

        expect(tilemap[1][0]).toEqual({ id: 'b', rotation: 0 });
        expect(tilemap[2][0]).toEqual({ id: 'a', rotation: 0 });
    });
});
