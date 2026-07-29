import fs from 'fs';

const gameLogLoadOrderRegex =
  /.*\[mods] Active (?:local|steam|workshop) mod (.*) \(name:.*/i;

export function getLoadOrder(gameLogPath: string) {
  const lines = fs.readFileSync(gameLogPath, { encoding: 'utf8' }).split('\n');
  const mods: string[] = [];

  for (const line of lines) {
    const mod = gameLogLoadOrderRegex.exec(line)?.[1]?.trim();
    if (!mod || mods.includes(mod)) {
      continue;
    }
    mods.push(mod);
  }

  return mods;
}

export function getLoadOrderFromFile(loadOrderPath: string) {
  const lines = fs
    .readFileSync(loadOrderPath, { encoding: 'utf8' })
    .split('\n');
  const mods: string[] = [];

  for (const line of lines) {
    const mod = line.replace(/(#|\/\/).*$/, '').trim();
    if (!mod || mods.includes(mod)) {
      continue;
    }
    mods.push(mod);
  }

  return mods;
}
