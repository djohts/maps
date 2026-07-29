import path from 'path';
import type { IndexedMod } from './mod-index';

export type ModConflictPolicy = 'warn' | 'error' | 'ignore';

export interface ResolveModsOptions {
  explicitOrder?: string[];
  gameLogOrder?: string[];
  enabledMods?: string[];
  disabledMods?: string[];
  strictDependencies?: boolean;
  conflictPolicy?: ModConflictPolicy;
}

export interface ResolveModsResult {
  orderedMods: IndexedMod[];
  warnings: string[];
}

export function resolveModLoadOrder(
  mods: IndexedMod[],
  {
    explicitOrder = [],
    gameLogOrder = [],
    enabledMods = [],
    disabledMods = [],
    strictDependencies = false,
    conflictPolicy = 'warn',
  }: ResolveModsOptions = {},
): ResolveModsResult {
  const warnings: string[] = [];
  const selectedMods = filterMods(mods, enabledMods, disabledMods, warnings);
  if (selectedMods.length === 0) {
    return { orderedMods: [], warnings };
  }

  const fallbackOrder = selectedMods
    .map(mod => mod.archivePath)
    .sort((a, b) => a.localeCompare(b));
  const fallbackRank = new Map<string, number>(
    fallbackOrder.map((archivePath, idx) => [archivePath, idx]),
  );

  const priorityRank = new Map<string, number>();
  let rank = 0;

  rank = addOrderRanks(
    selectedMods,
    explicitOrder,
    'explicit mod order',
    warnings,
    priorityRank,
    rank,
  );
  addOrderRanks(
    selectedMods,
    gameLogOrder,
    'game log mod order',
    warnings,
    priorityRank,
    rank,
  );

  const prioritizedMods = [...selectedMods].sort((a, b) => {
    const rankA = priorityRank.get(a.archivePath);
    const rankB = priorityRank.get(b.archivePath);
    if (rankA != null && rankB != null) {
      return rankA - rankB;
    }
    if (rankA != null) {
      return -1;
    }
    if (rankB != null) {
      return 1;
    }

    return (
      (fallbackRank.get(a.archivePath) ?? Number.MAX_SAFE_INTEGER) -
      (fallbackRank.get(b.archivePath) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  const dependencyEdges = new Map<string, Set<string>>();
  for (const mod of prioritizedMods) {
    dependencyEdges.set(mod.archivePath, new Set());
  }

  for (const mod of prioritizedMods) {
    for (const dependency of mod.dependencies) {
      const matched = findModsByReference(prioritizedMods, dependency).filter(
        candidate => candidate.archivePath !== mod.archivePath,
      );
      if (matched.length === 0) {
        const message = `${mod.displayName} is missing dependency "${dependency}"`;
        if (strictDependencies) {
          throw new Error(message);
        }
        if (conflictPolicy === 'warn') {
          warnings.push(message);
        }
        continue;
      }

      if (matched.length > 1) {
        warnings.push(
          `${mod.displayName} dependency "${dependency}" matched multiple mods: ${matched
            .map(m => m.displayName)
            .join(', ')}`,
        );
      }

      const selectedDependency = matched[0];
      dependencyEdges.get(selectedDependency.archivePath)?.add(mod.archivePath);
    }

    for (const incompatible of mod.incompatible) {
      const matched = findModsByReference(prioritizedMods, incompatible).filter(
        candidate => candidate.archivePath !== mod.archivePath,
      );
      if (matched.length === 0) {
        continue;
      }

      const message = `${mod.displayName} is incompatible with ${matched
        .map(m => m.displayName)
        .join(', ')}`;
      if (conflictPolicy === 'error') {
        throw new Error(message);
      }
      if (conflictPolicy === 'warn') {
        warnings.push(message);
      }
    }
  }

  const sorted = stableTopologicalSort(prioritizedMods, dependencyEdges);
  if (sorted.length !== prioritizedMods.length) {
    warnings.push(
      'detected cyclic mod dependencies; falling back to non-dependency order',
    );
    return {
      orderedMods: prioritizedMods,
      warnings,
    };
  }

  return {
    orderedMods: sorted,
    warnings,
  };
}

export function normalizeModReference(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.(scs|zip)$/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

function filterMods(
  mods: IndexedMod[],
  enabledMods: string[],
  disabledMods: string[],
  warnings: string[],
) {
  const enabled = normalizeReferenceSet(enabledMods);
  const disabled = normalizeReferenceSet(disabledMods);

  let selected = mods;
  if (enabled.size > 0) {
    selected = mods.filter(mod => hasAnyAlias(mod, enabled));
    for (const ref of enabled) {
      if (!mods.some(mod => hasAlias(mod, ref))) {
        warnings.push(`enabled mod reference "${ref}" did not match any mod`);
      }
    }
  }

  if (disabled.size > 0) {
    for (const ref of disabled) {
      if (!selected.some(mod => hasAlias(mod, ref))) {
        warnings.push(`disabled mod reference "${ref}" did not match any mod`);
      }
    }
    selected = selected.filter(mod => !hasAnyAlias(mod, disabled));
  }

  return selected;
}

function normalizeReferenceSet(values: string[]) {
  const refs = new Set<string>();
  for (const value of values) {
    const normalized = normalizeModReference(value);
    if (normalized) {
      refs.add(normalized);
    }
  }
  return refs;
}

function addOrderRanks(
  mods: IndexedMod[],
  references: string[],
  source: string,
  warnings: string[],
  priorityRank: Map<string, number>,
  initialRank: number,
) {
  let rank = initialRank;
  for (const ref of references) {
    const matched = findModsByReference(mods, ref);
    if (matched.length === 0) {
      warnings.push(`${source} references unknown mod "${ref}"`);
      continue;
    }
    if (matched.length > 1) {
      warnings.push(
        `${source} reference "${ref}" matched multiple mods: ${matched
          .map(m => m.displayName)
          .join(', ')}`,
      );
    }
    for (const mod of matched) {
      if (priorityRank.has(mod.archivePath)) {
        continue;
      }
      priorityRank.set(mod.archivePath, rank);
      rank++;
    }
  }
  return rank;
}

function findModsByReference(mods: IndexedMod[], ref: string) {
  const normalized = normalizeModReference(ref);
  if (!normalized) {
    return [];
  }
  return mods.filter(mod => hasAlias(mod, normalized));
}

function hasAnyAlias(mod: IndexedMod, refs: Set<string>) {
  for (const ref of refs) {
    if (hasAlias(mod, ref)) {
      return true;
    }
  }
  return false;
}

function hasAlias(mod: IndexedMod, normalizedRef: string) {
  return getModAliases(mod).some(alias => alias === normalizedRef);
}

function getModAliases(mod: IndexedMod) {
  const archiveBasename = path.basename(mod.archivePath);
  const aliases = [
    mod.canonicalName,
    mod.displayName,
    mod.fileStem,
    archiveBasename,
  ]
    .map(normalizeModReference)
    .filter(alias => alias.length > 0);
  return [...new Set(aliases)];
}

function stableTopologicalSort(
  mods: IndexedMod[],
  edges: Map<string, Set<string>>,
) {
  const indexByArchivePath = new Map<string, number>(
    mods.map((mod, idx) => [mod.archivePath, idx]),
  );
  const modByArchivePath = new Map<string, IndexedMod>(
    mods.map(mod => [mod.archivePath, mod]),
  );
  const indegrees = new Map<string, number>(
    mods.map(mod => [mod.archivePath, 0]),
  );

  for (const toSet of edges.values()) {
    for (const toArchivePath of toSet) {
      indegrees.set(toArchivePath, (indegrees.get(toArchivePath) ?? 0) + 1);
    }
  }

  const queue = mods
    .filter(mod => (indegrees.get(mod.archivePath) ?? 0) === 0)
    .sort(
      (a, b) =>
        (indexByArchivePath.get(a.archivePath) ?? Number.MAX_SAFE_INTEGER) -
        (indexByArchivePath.get(b.archivePath) ?? Number.MAX_SAFE_INTEGER),
    );

  const result: IndexedMod[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    result.push(current);

    const nextSet = edges.get(current.archivePath);
    if (!nextSet) {
      continue;
    }

    for (const nextArchivePath of nextSet) {
      const nextIndegree = (indegrees.get(nextArchivePath) ?? 0) - 1;
      indegrees.set(nextArchivePath, nextIndegree);
      if (nextIndegree === 0) {
        const nextMod = modByArchivePath.get(nextArchivePath);
        if (nextMod) {
          queue.push(nextMod);
        }
      }
    }

    queue.sort(
      (a, b) =>
        (indexByArchivePath.get(a.archivePath) ?? Number.MAX_SAFE_INTEGER) -
        (indexByArchivePath.get(b.archivePath) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  return result;
}
