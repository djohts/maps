import fs from 'fs';
import path from 'path';
import { convertSiiToJson } from './convert-sii-to-json';
import type { Entries } from './scs-archive';
import { ScsArchive } from './scs-archive';
import { AnySiiSchema } from './sii-schemas';

const archiveExtensions = new Set(['.scs', '.zip']);
const manifestCandidatePaths = [
  'manifest.sii',
  'mod_description.sii',
  'mod/manifest.sii',
  'mod/mod_description.sii',
];

export interface IndexedMod {
  archivePath: string;
  fileStem: string;
  canonicalName: string;
  displayName: string;
  dependencies: string[];
  incompatible: string[];
  manifestPath?: string;
}

export interface ModIndexResult {
  mods: IndexedMod[];
  warnings: string[];
}

interface ManifestMetadata {
  manifestPath: string;
  packageName?: string;
  displayName?: string;
  dependencies: string[];
  incompatible: string[];
}

export function discoverModArchivePaths(modsDir: string): string[] {
  const roots = [modsDir];
  const archivePaths: string[] = [];

  while (roots.length) {
    const root = roots.pop();
    if (!root) continue;

    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        roots.push(fullPath);
      } else if (
        entry.isFile() &&
        archiveExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        archivePaths.push(fullPath);
      }
    }
  }

  archivePaths.sort((a, b) => a.localeCompare(b));
  return archivePaths;
}

export function indexModsFromDirectory(modsDir: string): ModIndexResult {
  return indexModArchives(discoverModArchivePaths(modsDir));
}

export function indexModArchives(archivePaths: string[]): ModIndexResult {
  const mods: IndexedMod[] = [];
  const warnings: string[] = [];

  for (const archivePath of archivePaths) {
    const archive = ScsArchive(archivePath);
    const fileStem = path.parse(archivePath).name;

    try {
      if (!archive.isValid()) {
        warnings.push(`ignoring invalid archive ${archivePath}`);
        continue;
      }

      const metadata = readManifestMetadata(archive.parseEntries());
      const canonicalName = metadata?.packageName ?? fileStem;
      mods.push({
        archivePath,
        fileStem,
        canonicalName,
        displayName: metadata?.displayName ?? canonicalName,
        dependencies: metadata?.dependencies ?? [],
        incompatible: metadata?.incompatible ?? [],
        manifestPath: metadata?.manifestPath,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`ignoring unreadable archive ${archivePath}: ${message}`);
    } finally {
      archive.dispose();
    }
  }

  return {
    mods,
    warnings,
  };
}

function readManifestMetadata(entries: Entries): ManifestMetadata | undefined {
  for (const candidatePath of manifestCandidatePaths) {
    const parsed = convertSiiToJson(candidatePath, entries, AnySiiSchema);
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const modPackage = findModPackage(parsed);
    if (!modPackage) {
      continue;
    }

    return {
      manifestPath: candidatePath,
      packageName: toStringOrUndefined(modPackage['packageName']),
      displayName:
        toStringOrUndefined(modPackage['displayName']) ??
        toStringOrUndefined(modPackage['packageName']),
      dependencies: uniqueStrings(toStringArray(modPackage['dependencies'])),
      incompatible: uniqueStrings(toStringArray(modPackage['incompatible'])),
    };
  }

  return undefined;
}

function findModPackage(parsed: Record<string, unknown>) {
  const candidates: Record<string, unknown>[] = [];

  for (const root of Object.values(parsed)) {
    if (!isRecord(root)) {
      continue;
    }
    for (const child of Object.values(root)) {
      if (isRecord(child)) {
        candidates.push(child);
      }
    }
  }

  for (const candidate of candidates) {
    if (
      candidate['packageName'] != null ||
      candidate['displayName'] != null ||
      candidate['dependencies'] != null ||
      candidate['incompatible'] != null
    ) {
      return candidate;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

function toStringOrUndefined(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === 'string');
}

function uniqueStrings(values: string[]) {
  const deduped: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || deduped.includes(trimmed)) {
      continue;
    }
    deduped.push(trimmed);
  }
  return deduped;
}
