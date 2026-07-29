import type { IndexedMod } from '../mod-index';
import {
  normalizeModReference,
  resolveModLoadOrder,
} from '../mods-resolver';

const createMod = (
  name: string,
  overrides: Partial<IndexedMod> = {},
): IndexedMod => ({
  archivePath: `/mods/${name}.scs`,
  fileStem: name,
  canonicalName: name,
  displayName: name,
  dependencies: [],
  incompatible: [],
  ...overrides,
});

describe('resolveModLoadOrder', () => {
  it('combines explicit order, game-log order, and fallback order', () => {
    const mods = [createMod('zeta'), createMod('alpha'), createMod('beta')];
    const { orderedMods } = resolveModLoadOrder(mods, {
      explicitOrder: ['beta'],
      gameLogOrder: ['zeta'],
    });
    expect(orderedMods.map(m => m.canonicalName)).toEqual([
      'beta',
      'zeta',
      'alpha',
    ]);
  });

  it('reorders mods to satisfy dependencies', () => {
    const mods = [
      createMod('addon', {
        dependencies: ['core'],
      }),
      createMod('core'),
    ];
    const { orderedMods } = resolveModLoadOrder(mods, {
      explicitOrder: ['addon', 'core'],
    });
    expect(orderedMods.map(m => m.canonicalName)).toEqual(['core', 'addon']);
  });

  it('warns on missing dependencies when strict mode is disabled', () => {
    const mods = [
      createMod('addon', {
        dependencies: ['core'],
      }),
    ];
    const { warnings } = resolveModLoadOrder(mods);
    expect(warnings).toContain('addon is missing dependency "core"');
  });

  it('throws on missing dependencies when strict mode is enabled', () => {
    const mods = [
      createMod('addon', {
        dependencies: ['core'],
      }),
    ];
    expect(() =>
      resolveModLoadOrder(mods, {
        strictDependencies: true,
      }),
    ).toThrow('addon is missing dependency "core"');
  });

  it('supports enable/disable mod filters', () => {
    const mods = [createMod('alpha'), createMod('beta'), createMod('gamma')];
    const { orderedMods } = resolveModLoadOrder(mods, {
      enabledMods: ['alpha', 'gamma'],
      disabledMods: ['gamma'],
    });
    expect(orderedMods.map(m => m.canonicalName)).toEqual(['alpha']);
  });

  it('supports warn/error policies for incompatible mods', () => {
    const mods = [
      createMod('modA', {
        incompatible: ['modB'],
      }),
      createMod('modB'),
    ];

    const warnResult = resolveModLoadOrder(mods, {
      conflictPolicy: 'warn',
    });
    expect(warnResult.warnings).toContain('modA is incompatible with modB');

    expect(() =>
      resolveModLoadOrder(mods, {
        conflictPolicy: 'error',
      }),
    ).toThrow('modA is incompatible with modB');
  });
});

describe('normalizeModReference', () => {
  it('normalizes names and strips archive extensions', () => {
    expect(normalizeModReference('  ProMods-Canada.scs  ')).toBe(
      'promodscanada',
    );
    expect(normalizeModReference('My Mod.zip')).toBe('mymod');
  });
});
