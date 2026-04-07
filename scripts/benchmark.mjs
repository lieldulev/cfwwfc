/**
 * Manual performance check: run after `npm run build`.
 * Example: `npm run benchmark`
 */
import generateMap, { SquareTilePositions } from '../dist/index.js';

function trivialTile(id) {
    return {
        id,
        weight: 1,
        tileAllowed(_e, _self, _n, _ne) {
            return true;
        },
        edgeAllowed() {
            return true;
        },
        rotationAllowed() {
            return true;
        },
    };
}

const tileset = new Map([['a', trivialTile('a')], ['b', trivialTile('b')]]);

function timeMs(label, fn) {
    const t0 = performance.now();
    fn();
    const ms = performance.now() - t0;
    console.log(`${label}: ${ms.toFixed(1)} ms`);
}

timeMs('32×32 square (1024 tiles), trivial tileset', () => generateMap(32, 32, tileset, SquareTilePositions));
timeMs('64×64 square (4096 tiles), trivial tileset', () => generateMap(64, 64, tileset, SquareTilePositions));
timeMs('128×128 square (16384 tiles), trivial tileset', () => generateMap(128, 128, tileset, SquareTilePositions));
timeMs('256×256 square (65536 tiles), trivial tileset', () => generateMap(256, 256, tileset, SquareTilePositions));
timeMs('512×512 square (262144 tiles), trivial tileset', () => generateMap(512, 512, tileset, SquareTilePositions));
