#!/usr/bin/env -S NODE_OPTIONS=--max-old-space-size=32768 npx tsx

import type { DefData, MapData } from '@truckermudgeon/map/types';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as process from 'process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { indexModsFromDirectory } from './game-files/mod-index';
import { parseMapFiles } from './game-files/map-files-parser';
import {
  getLoadOrder,
  getLoadOrderFromFile,
} from './game-files/mods-load-order';
import {
  resolveModLoadOrder,
  type ModConflictPolicy,
} from './game-files/mods-resolver';
import { logger } from './logger';

const homeDirectory = os.homedir();
const untildify = (value: string) =>
  homeDirectory ? value.replace(/^~(?=$|\/|\\)/, homeDirectory) : value;
const parseModList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

function main() {
  const args = yargs(hideBin(process.argv))
    .wrap(yargs().terminalWidth()) // Use full width of wide terminals.
    .usage(
      'Parses ATS/ETS2 game data and mods data and outputs map JSON and PNG files.\n',
    )
    .usage('Usage: $0 -g <dir> -m <dir> -o <dir>')
    .option('gameDir', {
      alias: 'g',
      describe: 'Path to ATS/ETS2 game dir (the one with all the .scs files)',
      type: 'string',
      coerce: untildify,
      demandOption: true,
    })
    .option('modsDir', {
      alias: 'm',
      describe: 'Path to ATS/ETS2 mods dir (the one with all the mods files)',
      type: 'string',
      coerce: untildify,
    })
    .option('gameLog', {
      alias: 'l',
      describe: 'Path to game log file (game.log.txt), used to read mod order',
      type: 'string',
      coerce: untildify,
    })
    .option('modOrderFile', {
      describe:
        'Path to text file with one mod identifier per line in load order (low to high priority)',
      type: 'string',
      coerce: untildify,
    })
    .option('modOrder', {
      describe:
        'Comma-separated explicit mod load order (low to high priority). Supports package names or filenames.',
      type: 'string',
    })
    .option('enabledMods', {
      describe:
        'Comma-separated list of mods to include. Supports package names or filenames.',
      type: 'string',
    })
    .option('disabledMods', {
      describe:
        'Comma-separated list of mods to exclude. Supports package names or filenames.',
      type: 'string',
    })
    .option('strictModDependencies', {
      describe: 'Fail when a mod dependency is missing',
      type: 'boolean',
      default: false,
    })
    .option('modConflictPolicy', {
      describe: 'How to handle incompatible mods',
      choices: ['warn', 'error', 'ignore'] as const,
      default: 'warn' as const,
    })
    .option('outputDir', {
      alias: 'o',
      describe: 'Path to dir JSON and PNG files should be written to',
      type: 'string',
      coerce: untildify,
      demandOption: true,
    })
    .option('includeDlc', {
      describe: 'Include DLC files',
      type: 'boolean',
      default: true,
    })
    .option('onlyDefs', {
      describe: 'Parse data from /def files, only',
      type: 'boolean',
      default: false,
    })
    .option('dryRun', {
      describe: "Don't write out any files",
      type: 'boolean',
      default: false,
    })
    .option('debug', {
      describe: 'Set debug mode to print more message',
      type: 'boolean',
      default: false,
    })
    .parseSync();

  const requiredFiles = new Set([
    'base.scs',
    'base_map.scs',
    'base_share.scs',
    'core.scs',
    'def.scs',
    'locale.scs',
    'version.scs',
  ]);
  if (args.debug) logger.level = 4;

  const gameFilePaths = fs
    .readdirSync(args.gameDir, { withFileTypes: true })
    .filter(
      e =>
        (e.isFile() && e.name.endsWith('.scs') && requiredFiles.has(e.name)) ||
        (args.includeDlc && e.name.startsWith('dlc')),
    )
    .map(e => {
      return path.join(args.gameDir, e.name);
    });

  const gameLogModOrder = args.gameLog ? getLoadOrder(args.gameLog) : [];
  const explicitModOrder = [
    ...parseModList(args.modOrder),
    ...(args.modOrderFile ? getLoadOrderFromFile(args.modOrderFile) : []),
  ];
  const enabledMods = parseModList(args.enabledMods);
  const disabledMods = parseModList(args.disabledMods);

  let modFilePaths: string[] = [];
  if (args.modsDir) {
    const { mods, warnings: indexWarnings } = indexModsFromDirectory(args.modsDir);
    indexWarnings.forEach(warning => logger.warn(warning));

    const { orderedMods, warnings: resolverWarnings } = resolveModLoadOrder(mods, {
      explicitOrder: explicitModOrder,
      gameLogOrder: gameLogModOrder,
      enabledMods,
      disabledMods,
      strictDependencies: args.strictModDependencies,
      conflictPolicy: args.modConflictPolicy as ModConflictPolicy,
    });
    resolverWarnings.forEach(warning => logger.warn(warning));

    modFilePaths = orderedMods.map(m => m.archivePath);
    logger.info('using', modFilePaths.length, 'mod archives');
    if (args.debug) {
      orderedMods.forEach((mod, idx) =>
        logger.debug(
          `${idx.toString().padStart(3, '0')}`,
          mod.canonicalName,
          '=>',
          mod.archivePath,
        ),
      );
    }
  }

  const { map, ...result } = parseMapFiles(gameFilePaths, modFilePaths, args);

  if (args.dryRun) {
    logger.success('dry run complete.');
    return;
  }

  if (!fs.existsSync(args.outputDir)) {
    fs.mkdirSync(args.outputDir, { recursive: true });
  }

  const data = result.onlyDefs ? result.defData : result.mapData;
  for (const key of Object.keys(data)) {
    const collection = data[key as keyof (MapData | DefData)];
    const filename = `${map}-${key}.json`;
    logger.log('writing', collection.length, `entries to ${filename}...`);

    const filePath = path.join(args.outputDir, filename);
    fs.rmSync(filePath, { recursive: true, force: true });
    const ws = fs.createWriteStream(filePath, {
      flags: 'a',
    });
    try {
      for (let start = 0; start < collection.length; start += 32768) {
        let str = JSON.stringify(
          collection.slice(start, start + 32768),
          null,
          2,
        );

        if (start !== 0) str = ',' + str.substring(1);
        if (start + 32768 < collection.length)
          str = str.substring(0, str.length - 1);

        ws.write(str);
      }
    } finally {
      ws.end();
    }
  }

  const pngOutputDir = path.join(args.outputDir, 'icons');
  if (!result.onlyDefs) {
    const { icons } = result;
    logger.log('writing', icons.size, `.png files to ${pngOutputDir}...`);
    if (!fs.existsSync(pngOutputDir)) {
      fs.mkdirSync(pngOutputDir);
    }
    for (const [name, buffer] of icons) {
      fs.writeFileSync(path.join(pngOutputDir, name + '.png'), buffer);
    }
  }

  logger.success('done.');
}

// Ensure `BigInt`s are `JSON.serialize`d as hex strings, so they can be
// `JSON.parse`d without any data loss.
//
// Do this before calling `main()` (or executing any other code that might
// involve serializing bigints to JSON).

// eslint-disable-next-line
interface BigIntWithToJSON extends BigInt {
  toJSON(): string;
}

(BigInt.prototype as BigIntWithToJSON).toJSON = function () {
  return this.toString(16);
};

main();
