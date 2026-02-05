// scripts/via-dev/definitions-fs.ts
import path from 'node:path';
import crypto, {BinaryLike} from 'node:crypto';
import fs from 'fs-extra';
import type {Plugin} from 'vite';
import {
  getTheme,
  keyboardDefinitionV2ToVIADefinitionV2,
  keyboardDefinitionV3ToVIADefinitionV3,
  type DefinitionVersion,
  type KeyboardDefinitionIndex,
  type KeyboardDefinitionV2,
  type KeyboardDefinitionV3,
  type VIADefinitionV2,
  type VIADefinitionV3,
} from '@the-via/reader';

type AnyKeyboardDef = KeyboardDefinitionV2 | KeyboardDefinitionV3;
type AnyVIADef = VIADefinitionV2 | VIADefinitionV3;

type WriteOptions = {
  /** Absolute path to your app's public folder */
  publicDir: string; // e.g. path.resolve(process.cwd(), 'public')
  /** App/package version for supported_kbs.json (optional) */
  appVersion?: string;
};

/** Endpoint payload accepted by the dev middleware */
type WriteRequestBody =
  | {
      version: DefinitionVersion; // 'v2' | 'v3'
      keyboardDefinition: AnyKeyboardDef;
    }
  | {
      version: DefinitionVersion;
      viaDefinition: AnyVIADef;
    };

function sha256(input: BinaryLike) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function readJsonSafe<T>(filePath: string): Promise<T | null> {
  return fs
    .readJson(filePath)
    .then((x) => x as T)
    .catch(() => null);
}

function uniqueSorted(nums: number[]) {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function ensureNumArray(v: unknown): number[] {
  return Array.isArray(v)
    ? v.map(Number).filter((n) => Number.isFinite(n))
    : [];
}

function stripGeneratedAt(
  index: KeyboardDefinitionIndex,
): KeyboardDefinitionIndex {
  // keep same shape but remove generatedAt for hashing stability (like keyboards build does)
  return {...index, generatedAt: undefined as any};
}

async function computeDefinitionsDirHash(dir: string) {
  if (!(await fs.pathExists(dir))) return sha256('empty');
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const parts: string[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const content = await fs.readFile(full, 'utf8');
    parts.push(f);
    parts.push(content);
  }
  return sha256(parts.join('\n'));
}

function toViaDefinition(
  version: DefinitionVersion,
  def: AnyKeyboardDef,
): AnyVIADef {
  if (version === 'v2')
    return keyboardDefinitionV2ToVIADefinitionV2(def as KeyboardDefinitionV2);
  return keyboardDefinitionV3ToVIADefinitionV3(def as KeyboardDefinitionV3);
}

async function upsertSupportedIndex(
  definitionsRoot: string,
  vendorProductId: number,
  version: DefinitionVersion,
  appVersion?: string,
) {
  const supportedPath = path.join(definitionsRoot, 'supported_kbs.json');
  const now = Date.now();

  const existing = await readJsonSafe<KeyboardDefinitionIndex>(supportedPath);

  const base: KeyboardDefinitionIndex = existing ?? {
    generatedAt: now,
    version: appVersion ?? 'dev',
    theme: getTheme(),
    vendorProductIds: {v2: [], v3: []},
  };

  const v2 = ensureNumArray(base.vendorProductIds?.v2);
  const v3 = ensureNumArray(base.vendorProductIds?.v3);

  if (version === 'v2') {
    // if present in v2, it should not appear in v3 (the keyboards build does that)
    const newV2 = uniqueSorted([...v2, vendorProductId]);
    const newV3 = uniqueSorted(v3.filter((id) => id !== vendorProductId));
    base.vendorProductIds = {v2: newV2, v3: newV3};
  } else {
    // v3 should exclude any ids present in v2
    const newV3 = uniqueSorted([...v3, vendorProductId]).filter(
      (id) => !v2.includes(id),
    );
    base.vendorProductIds = {v2: uniqueSorted(v2), v3: newV3};
  }

  base.generatedAt = now;
  base.version = appVersion ?? base.version ?? 'dev';
  base.theme = base.theme ?? getTheme();

  await fs.ensureDir(definitionsRoot);
  await fs.writeFile(supportedPath, JSON.stringify(base, null, 2), 'utf8');
}

async function updateHashJson(definitionsRoot: string) {
  const v2Dir = path.join(definitionsRoot, 'v2');
  const v3Dir = path.join(definitionsRoot, 'v3');
  const supportedPath = path.join(definitionsRoot, 'supported_kbs.json');

  const supported = (await readJsonSafe<KeyboardDefinitionIndex>(
    supportedPath,
  )) ?? {
    generatedAt: Date.now(),
    version: 'dev',
    theme: getTheme(),
    vendorProductIds: {v2: [], v3: []},
  };

  const v2Hash = await computeDefinitionsDirHash(v2Dir);
  const v3Hash = await computeDefinitionsDirHash(v3Dir);
  const supportedNoGen = stripGeneratedAt(supported);

  const combined = JSON.stringify([v2Hash, v3Hash, supportedNoGen]);
  const hash = sha256(combined);

  const hashPath = path.join(definitionsRoot, 'hash.json');
  await fs.writeFile(hashPath, JSON.stringify(hash, null, 2), 'utf8');
}

/**
 * Writes a VIADefinition json into public/definitions/<version>/<vendorProductId>.json
 * Updates supported_kbs.json and hash.json so the app can resync without a full rebuild.
 */
export async function writeDefinitionToPublic(
  body: WriteRequestBody,
  opts: WriteOptions,
): Promise<{
  vendorProductId: number;
  version: DefinitionVersion;
  outFile: string;
}> {
  const {publicDir, appVersion} = opts;
  const definitionsRoot = path.join(publicDir, 'definitions');

  const version = body.version;
  const viaDef: AnyVIADef =
    'viaDefinition' in body
      ? body.viaDefinition
      : toViaDefinition(version, body.keyboardDefinition);

  const vendorProductId = (viaDef as any).vendorProductId as number;
  if (!Number.isFinite(vendorProductId)) {
    throw new Error('Invalid vendorProductId produced by conversion.');
  }

  const outDir = path.join(definitionsRoot, version);
  await fs.ensureDir(outDir);

  const outFile = path.join(outDir, `${vendorProductId}.json`);
  await fs.writeFile(outFile, JSON.stringify(viaDef, null, 2), 'utf8');

  await upsertSupportedIndex(
    definitionsRoot,
    vendorProductId,
    version,
    appVersion,
  );
  await updateHashJson(definitionsRoot);

  return {vendorProductId, version, outFile};
}

/**
 * Vite dev plugin:
 * - Adds POST /__via/dev/write-definition
 * - Accepts {version, keyboardDefinition} OR {version, viaDefinition}
 * - Writes into public/definitions and updates supported_kbs.json + hash.json
 */
export function viaDevDefinitionsPlugin(opts: WriteOptions): Plugin {
  const endpoint = '/__via/dev/write-definition';

  return {
    name: 'via-dev-definitions-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || req.url !== endpoint) return next();

        req.setEncoding('utf8'); // <-- così i chunk sono stringhe
        let raw = '';

        req.on('data', (chunk) => {
          raw += chunk;
        });

        req.on('end', async () => {
          try {
            const parsed = JSON.parse(raw) as WriteRequestBody;
            const result = await writeDefinitionToPublic(parsed, opts);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ok: true, ...result}));
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({ok: false, error: String(e?.message ?? e)}),
            );
          }
        });

        req.on('error', (e) => {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ok: false, error: String(e)}));
        });
      });
    },
  };
}
