#!/usr/bin/env node
// Validate that the JSON index definitions committed under
// `infra/atlas-search/` match what is currently live in MongoDB Atlas.
//
// Usage:
//   pnpm validate:atlas
//
// Env vars (all required):
//   ATLAS_PUBLIC_KEY     Programmatic API key public part
//   ATLAS_PRIVATE_KEY    Programmatic API key private part
//   ATLAS_GROUP_ID       Atlas Project ID (24-char hex, a.k.a. "groupId")
//   ATLAS_CLUSTER_NAME   Cluster name exactly as it appears in Atlas
//
// Optional:
//   ATLAS_DATABASE       Database name        (default: value from MONGODB_DB_NAME or "rollforge")
//   ATLAS_COLLECTION     Collection name      (default: "chunks")
//   ATLAS_API_HOST       Atlas API host       (default: "https://cloud.mongodb.com")
//
// Env vars are loaded from .env / .env.<NODE_ENV> / .env.local in that
// order (last one wins, matching src/config/env.ts). So the four ATLAS_*
// vars can live alongside the bot's other secrets in the normal .env
// files — no separate config file needed.
//
// Exits 0 when every committed JSON matches the live definition; exits 1
// on any drift or transport error. Intended for manual / pre-deploy use.

import { config as loadDotenv } from "dotenv";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_DIR = path.join(REPO_ROOT, "infra", "atlas-search");
const ATLAS_API_VERSION = "application/vnd.atlas.2024-05-30+json";

// Load env files with the same precedence as src/config/env.ts so the
// ATLAS_* vars can live in the existing .env / .env.local.
const nodeEnv = process.env.NODE_ENV ?? "development";
for (const file of [".env", `.env.${nodeEnv}`, ".env.local"]) {
  loadDotenv({ path: path.resolve(REPO_ROOT, file), override: true });
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`error: ${name} is not set`);
    console.error("see scripts/validate-atlas-indexes.mjs for the full list of required env vars");
    process.exit(2);
  }
  return v;
}

// ---------- HTTP digest auth (RFC 7616, MD5) ----------

function md5(s) {
  return createHash("md5").update(s).digest("hex");
}

function parseWwwAuthenticate(header) {
  // e.g. `Digest realm="MMS Public API", domain="...", nonce="abc", algorithm=MD5, qop="auth", stale=false`
  const out = {};
  const body = header.replace(/^Digest\s+/i, "");
  // Split on commas that are NOT inside double quotes.
  const parts = body.match(/(\w+)=("([^"]*)"|([^,]*))/g) ?? [];
  for (const part of parts) {
    const [k, ...rest] = part.split("=");
    const val = rest.join("=").trim();
    out[k.trim()] = val.replace(/^"|"$/g, "");
  }
  return out;
}

async function digestFetch(url, { user, password, accept }) {
  // First request — expect 401 with WWW-Authenticate: Digest ...
  const first = await fetch(url, { method: "GET", headers: { Accept: accept } });
  if (first.status !== 401) {
    // No digest challenge — return whatever came back.
    return first;
  }
  const wwwAuth = first.headers.get("www-authenticate");
  if (!wwwAuth || !/^Digest\s/i.test(wwwAuth)) {
    throw new Error(`Atlas returned 401 without a Digest challenge: ${wwwAuth ?? "(no header)"}`);
  }
  const challenge = parseWwwAuthenticate(wwwAuth);
  if (!challenge.realm || !challenge.nonce) {
    throw new Error(`malformed Digest challenge: ${wwwAuth}`);
  }

  const uri = new URL(url).pathname + new URL(url).search;
  const method = "GET";
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";
  const qop = challenge.qop
    ?.split(",")
    .map((s) => s.trim())
    .includes("auth")
    ? "auth"
    : challenge.qop;

  const ha1 = md5(`${user}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const authParts = [
    `username="${user}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${challenge.algorithm ?? "MD5"}`,
    `response="${response}"`,
  ];
  if (qop) {
    authParts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  if (challenge.opaque) {
    authParts.push(`opaque="${challenge.opaque}"`);
  }
  const authorization = `Digest ${authParts.join(", ")}`;

  return fetch(url, {
    method: "GET",
    headers: { Accept: accept, Authorization: authorization },
  });
}

// ---------- Atlas ----------

async function fetchLiveIndexes({ apiHost, groupId, clusterName, publicKey, privateKey }) {
  const url = `${apiHost}/api/atlas/v2/groups/${groupId}/clusters/${encodeURIComponent(clusterName)}/search/indexes`;
  const res = await digestFetch(url, {
    user: publicKey,
    password: privateKey,
    accept: ATLAS_API_VERSION,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Atlas ${res.status} ${res.statusText} at ${url}\n${body}`);
  }
  return res.json();
}

// ---------- Diff ----------

// Fields Atlas adds on top of the user-owned definition. Stripped
// before diffing so a response like
//   { name, type, indexID, status, latestDefinition: {...}, ... }
// does not show spurious drift against a committed JSON that only
// carries name/type/fields/mappings.
const META_FIELDS = new Set([
  "_comment",
  "_id",
  "indexID",
  "indexId",
  "status",
  "latestDefinition",
  "queryable",
]);

function stripMeta(def) {
  if (!def) return {};
  const out = {};
  for (const [k, v] of Object.entries(def)) {
    if (!META_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canonicalize(value[k]);
        return acc;
      }, {});
  }
  return value;
}

function diffDefinitions(localDef, liveDef) {
  // Compare the parts we actually own: for vector, the `fields` array;
  // for lexical, the `mappings` object. Also compare name + type.
  const differences = [];
  const fieldsToCompare = ["name", "type", "fields", "mappings"];
  for (const key of fieldsToCompare) {
    if (!(key in localDef) && !(key in liveDef)) continue;
    const l = canonicalize(localDef[key]);
    const r = canonicalize(liveDef[key]);
    if (JSON.stringify(l) !== JSON.stringify(r)) {
      differences.push({
        key,
        local: l,
        live: r,
      });
    }
  }
  return differences;
}

// ---------- Main ----------

async function main() {
  const publicKey = required("ATLAS_PUBLIC_KEY");
  const privateKey = required("ATLAS_PRIVATE_KEY");
  const groupId = required("ATLAS_GROUP_ID");
  const clusterName = required("ATLAS_CLUSTER_NAME");
  const database = process.env.ATLAS_DATABASE || process.env.MONGODB_DB_NAME || "rollforge";
  const collection = process.env.ATLAS_COLLECTION || "chunks";
  const apiHost = process.env.ATLAS_API_HOST || "https://cloud.mongodb.com";

  console.log(`Atlas project: ${groupId}`);
  console.log(`Cluster:       ${clusterName}`);
  console.log(`Target:        ${database}.${collection}`);
  console.log();

  // 1. Load every committed JSON file in infra/atlas-search/
  const files = (await readdir(INDEX_DIR)).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    console.error(`no .json files found in ${INDEX_DIR}`);
    process.exit(1);
  }

  const local = [];
  for (const file of files) {
    const raw = await readFile(path.join(INDEX_DIR, file), "utf8");
    const parsed = JSON.parse(raw);
    delete parsed._comment;
    if (!parsed.name) {
      console.error(`${file}: missing "name" field`);
      process.exit(1);
    }
    local.push({ file, def: parsed });
  }

  // 2. Fetch all live indexes on the cluster, filter to the target collection.
  let live;
  try {
    live = await fetchLiveIndexes({ apiHost, groupId, clusterName, publicKey, privateKey });
  } catch (err) {
    console.error(`fetch failed: ${err.message}`);
    process.exit(1);
  }

  const liveOnTarget = (Array.isArray(live) ? live : []).filter(
    (x) => x.database === database && x.collectionName === collection,
  );
  const liveByName = new Map(liveOnTarget.map((x) => [x.name, x]));

  console.log(`Live indexes on ${database}.${collection}: ${liveOnTarget.length}`);
  console.log(`Committed definitions:                    ${local.length}`);
  console.log();

  // 3. Diff each committed definition against its live counterpart.
  let drift = 0;
  for (const { file, def } of local) {
    const liveIndex = liveByName.get(def.name);
    if (!liveIndex) {
      console.log(`MISSING  ${file}  (name: ${def.name}) — no matching index in Atlas`);
      drift++;
      continue;
    }
    // Atlas returns the definition nested as `latestDefinition` (status,
    // queryable, etc. wrap it). Fall back to the top-level object if the
    // response shape changes.
    const liveDef = stripMeta(liveIndex.latestDefinition ?? liveIndex);
    const liveWithMeta = {
      name: liveIndex.name,
      type: liveIndex.type ?? liveDef.type ?? "search",
      ...liveDef,
    };
    const differences = diffDefinitions(def, liveWithMeta);
    if (differences.length === 0) {
      console.log(`OK       ${file}  (name: ${def.name})`);
    } else {
      console.log(`DRIFT    ${file}  (name: ${def.name})`);
      for (const d of differences) {
        console.log(`  ↳ ${d.key}:`);
        console.log(`      local: ${JSON.stringify(d.local)}`);
        console.log(`      live:  ${JSON.stringify(d.live)}`);
      }
      drift++;
    }
  }

  // 4. Also flag live indexes on the target collection that are NOT
  //    represented by a committed JSON — those are out-of-band additions.
  const committedNames = new Set(local.map((l) => l.def.name));
  for (const liveIndex of liveOnTarget) {
    if (!committedNames.has(liveIndex.name)) {
      console.log(`UNKNOWN  (live only) name: ${liveIndex.name}`);
      drift++;
    }
  }

  console.log();
  if (drift === 0) {
    console.log("All committed Atlas Search indexes match the live cluster.");
    process.exit(0);
  } else {
    console.log(`${drift} drift entries found — update Atlas or the committed JSONs.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
