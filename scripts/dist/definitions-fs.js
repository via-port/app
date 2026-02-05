"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeDefinitionToPublic = writeDefinitionToPublic;
exports.viaDevDefinitionsPlugin = viaDevDefinitionsPlugin;
// scripts/via-dev/definitions-fs.ts
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const reader_1 = require("@the-via/reader");
function sha256(input) {
    return node_crypto_1.default.createHash('sha256').update(input).digest('hex');
}
function readJsonSafe(filePath) {
    return fs_extra_1.default
        .readJson(filePath)
        .then((x) => x)
        .catch(() => null);
}
function uniqueSorted(nums) {
    return Array.from(new Set(nums)).sort((a, b) => a - b);
}
function ensureNumArray(v) {
    return Array.isArray(v)
        ? v.map(Number).filter((n) => Number.isFinite(n))
        : [];
}
function stripGeneratedAt(index) {
    // keep same shape but remove generatedAt for hashing stability (like keyboards build does)
    return { ...index, generatedAt: undefined };
}
async function computeDefinitionsDirHash(dir) {
    if (!(await fs_extra_1.default.pathExists(dir)))
        return sha256('empty');
    const files = (await fs_extra_1.default.readdir(dir))
        .filter((f) => f.endsWith('.json'))
        .sort((a, b) => a.localeCompare(b));
    const parts = [];
    for (const f of files) {
        const full = node_path_1.default.join(dir, f);
        const content = await fs_extra_1.default.readFile(full, 'utf8');
        parts.push(f);
        parts.push(content);
    }
    return sha256(parts.join('\n'));
}
function toViaDefinition(version, def) {
    if (version === 'v2')
        return (0, reader_1.keyboardDefinitionV2ToVIADefinitionV2)(def);
    return (0, reader_1.keyboardDefinitionV3ToVIADefinitionV3)(def);
}
async function upsertSupportedIndex(definitionsRoot, vendorProductId, version, appVersion) {
    const supportedPath = node_path_1.default.join(definitionsRoot, 'supported_kbs.json');
    const now = Date.now();
    const existing = await readJsonSafe(supportedPath);
    const base = existing ?? {
        generatedAt: now,
        version: appVersion ?? 'dev',
        theme: (0, reader_1.getTheme)(),
        vendorProductIds: { v2: [], v3: [] },
    };
    const v2 = ensureNumArray(base.vendorProductIds?.v2);
    const v3 = ensureNumArray(base.vendorProductIds?.v3);
    if (version === 'v2') {
        // if present in v2, it should not appear in v3 (the keyboards build does that)
        const newV2 = uniqueSorted([...v2, vendorProductId]);
        const newV3 = uniqueSorted(v3.filter((id) => id !== vendorProductId));
        base.vendorProductIds = { v2: newV2, v3: newV3 };
    }
    else {
        // v3 should exclude any ids present in v2
        const newV3 = uniqueSorted([...v3, vendorProductId]).filter((id) => !v2.includes(id));
        base.vendorProductIds = { v2: uniqueSorted(v2), v3: newV3 };
    }
    base.generatedAt = now;
    base.version = appVersion ?? base.version ?? 'dev';
    base.theme = base.theme ?? (0, reader_1.getTheme)();
    await fs_extra_1.default.ensureDir(definitionsRoot);
    await fs_extra_1.default.writeFile(supportedPath, JSON.stringify(base, null, 2), 'utf8');
}
async function updateHashJson(definitionsRoot) {
    const v2Dir = node_path_1.default.join(definitionsRoot, 'v2');
    const v3Dir = node_path_1.default.join(definitionsRoot, 'v3');
    const supportedPath = node_path_1.default.join(definitionsRoot, 'supported_kbs.json');
    const supported = (await readJsonSafe(supportedPath)) ?? {
        generatedAt: Date.now(),
        version: 'dev',
        theme: (0, reader_1.getTheme)(),
        vendorProductIds: { v2: [], v3: [] },
    };
    const v2Hash = await computeDefinitionsDirHash(v2Dir);
    const v3Hash = await computeDefinitionsDirHash(v3Dir);
    const supportedNoGen = stripGeneratedAt(supported);
    const combined = JSON.stringify([v2Hash, v3Hash, supportedNoGen]);
    const hash = sha256(combined);
    const hashPath = node_path_1.default.join(definitionsRoot, 'hash.json');
    await fs_extra_1.default.writeFile(hashPath, JSON.stringify(hash, null, 2), 'utf8');
}
/**
 * Writes a VIADefinition json into public/definitions/<version>/<vendorProductId>.json
 * Updates supported_kbs.json and hash.json so the app can resync without a full rebuild.
 */
async function writeDefinitionToPublic(body, opts) {
    const { publicDir, appVersion } = opts;
    const definitionsRoot = node_path_1.default.join(publicDir, 'definitions');
    const version = body.version;
    const viaDef = 'viaDefinition' in body
        ? body.viaDefinition
        : toViaDefinition(version, body.keyboardDefinition);
    const vendorProductId = viaDef.vendorProductId;
    if (!Number.isFinite(vendorProductId)) {
        throw new Error('Invalid vendorProductId produced by conversion.');
    }
    const outDir = node_path_1.default.join(definitionsRoot, version);
    await fs_extra_1.default.ensureDir(outDir);
    const outFile = node_path_1.default.join(outDir, `${vendorProductId}.json`);
    await fs_extra_1.default.writeFile(outFile, JSON.stringify(viaDef, null, 2), 'utf8');
    await upsertSupportedIndex(definitionsRoot, vendorProductId, version, appVersion);
    await updateHashJson(definitionsRoot);
    return { vendorProductId, version, outFile };
}
/**
 * Vite dev plugin:
 * - Adds POST /__via/dev/write-definition
 * - Accepts {version, keyboardDefinition} OR {version, viaDefinition}
 * - Writes into public/definitions and updates supported_kbs.json + hash.json
 */
function viaDevDefinitionsPlugin(opts) {
    const endpoint = '/__via/dev/write-definition';
    return {
        name: 'via-dev-definitions-writer',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.method !== 'POST' || req.url !== endpoint)
                    return next();
                req.setEncoding('utf8'); // <-- così i chunk sono stringhe
                let raw = '';
                req.on('data', (chunk) => {
                    raw += chunk;
                });
                req.on('end', async () => {
                    try {
                        const parsed = JSON.parse(raw);
                        const result = await writeDefinitionToPublic(parsed, opts);
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ ok: true, ...result }));
                    }
                    catch (e) {
                        res.statusCode = 400;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
                    }
                });
                req.on('error', (e) => {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ ok: false, error: String(e) }));
                });
            });
        },
    };
}
