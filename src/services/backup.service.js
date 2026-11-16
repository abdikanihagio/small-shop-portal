// Backups of the whole shop: every table, saved as one compressed file in BACKUP_DIR.
// - Automatic: once a day while the portal runs (checked every hour); the newest 30 are kept.
// - Manual ("Back up now"), uploaded files and the safety copy taken before a restore: newest 20 kept.
// - Restore (owner only) replaces everything in one transaction; a safety backup is taken first.
// A backup holds everything, including password hashes and two-step secrets, so only the owner may
// download one or bring one in (upload); other admins can see the list and make backups.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const BackupModel = require('../models/backup.model');
const SettingsModel = require('../models/settings.model');
const audit = require('./audit.service');
const { snapshot, transaction } = require('../config/database');
const { BACKUP_DIR, BACKUP_FIRST_CHECK_MS } = require('../config/environment');
const { today } = require('../utils/dates');
const { bad, notFound, forbidden } = require('../utils/http-error');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const FORMAT = 'small-shop-backup';
const VERSION = 1;
const KINDS = ['auto', 'manual', 'before-restore', 'uploaded'];
const KEEP = { auto: 30, other: 20 };
const NAME_RE = /^shop-backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:-\d+)?-(auto|manual|before-restore|uploaded)\.json\.gz$/;
const MAX_UNPACKED = 1024 * 1024 * 1024; // refuse files that would unpack to more than 1 GB

let lastAutoError = null; // shown in Settings if the daily backup could not be made

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

function describe(name, size) {
  const m = NAME_RE.exec(name);
  return { name, kind: m[7], created_at: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`, size };
}

// Every backup file, newest first.
async function list() {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const out = [];
  for (const name of await fsp.readdir(BACKUP_DIR)) {
    if (!NAME_RE.test(name)) continue;
    out.push(describe(name, (await fsp.stat(path.join(BACKUP_DIR, name))).size));
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.name.localeCompare(a.name)));
}

async function status() {
  const backups = await list();
  return {
    folder: BACKUP_DIR,
    keep: KEEP,
    last_auto: backups.find((b) => b.kind === 'auto') || null,
    auto_error: lastAutoError,
    backups,
  };
}

// The full path of a backup, refusing anything that isn't one of ours (no "..\" tricks).
function filePath(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw bad('Unknown backup');
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw notFound('Backup not found');
  return file;
}

// Buffers (the logo) are written as { $bytes: base64 } and turned back into Buffers when restoring.
const encode = (key, value) => (value && value.type === 'Buffer' && Array.isArray(value.data) ? { $bytes: Buffer.from(value.data).toString('base64') } : value);
const decodeRows = (rows) =>
  rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v && typeof v === 'object' && typeof v.$bytes === 'string' ? Buffer.from(v.$bytes, 'base64') : v])));

async function writeFile(kind, data) {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  let name = `shop-backup-${stamp()}-${kind}.json.gz`;
  for (let n = 2; fs.existsSync(path.join(BACKUP_DIR, name)); n++) name = `shop-backup-${stamp()}-${n}-${kind}.json.gz`;
  const file = path.join(BACKUP_DIR, name);
  await fsp.writeFile(file + '.part', data);
  await fsp.rename(file + '.part', file); // a half-written file never looks like a backup
  return describe(name, data.length);
}

// Deletes the oldest files beyond what is kept.
async function prune() {
  const backups = await list();
  const old = [...backups.filter((b) => b.kind === 'auto').slice(KEEP.auto), ...backups.filter((b) => b.kind !== 'auto').slice(KEEP.other)];
  for (const b of old) await fsp.rm(path.join(BACKUP_DIR, b.name), { force: true });
}

// Takes a backup. kind: auto | manual | before-restore. actor: who asked (none for automatic ones).
async function create(kind, actor = null) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown backup kind ${kind}`);
  const tables = await snapshot(() => BackupModel.readAll());
  const counts = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
  const shop = (await SettingsModel.all()).shop_name;
  const json = JSON.stringify({ format: FORMAT, version: VERSION, created_at: new Date().toISOString(), shop, counts, tables }, encode);
  const info = await writeFile(kind, await gzip(json));
  await prune();
  await audit.record(actor || { username: '(automatic)', ip: 'local' }, 'backup.created', 'backup', info.name, { kind, size_kb: Math.ceil(info.size / 1024), sales: counts.sales });
  return info;
}

// Unpacks and checks a backup file; returns { tables, … }.
async function read(buffer) {
  let doc;
  try {
    doc = JSON.parse((await gunzip(buffer, { maxOutputLength: MAX_UNPACKED })).toString('utf8'));
  } catch {
    throw bad('This is not a Small Shop backup file (it could not be opened).');
  }
  if (doc?.format !== FORMAT || typeof doc.tables !== 'object' || !Array.isArray(doc.tables.users)) throw bad('This is not a Small Shop backup file.');
  if (doc.version > VERSION) throw bad('This backup was made by a newer version of the portal. Update the portal first.');
  if (!doc.tables.users.some((u) => u.role === 'admin')) throw bad('This backup has no admin account, so nobody could sign in after restoring it.');
  for (const t of BackupModel.TABLES) if (doc.tables[t] !== undefined && !Array.isArray(doc.tables[t])) throw bad('This backup file is damaged.');
  return doc;
}

// Puts a backup in place of everything in the database. Owner only.
async function restore(actor, name) {
  if (!actor.is_owner) throw forbidden('Only the owner can restore a backup');
  const doc = await read(await fsp.readFile(filePath(name)));
  const safety = await create('before-restore', actor);
  const tables = Object.fromEntries(BackupModel.TABLES.map((t) => [t, decodeRows(doc.tables[t] || [])]));
  await transaction(() => BackupModel.replaceAll(tables));
  // Recorded after the restore, so it shows in the restored activity log. No user id: that
  // account may not exist in the restored data.
  await audit.record({ username: actor.username, ip: actor.ip }, 'backup.restored', 'backup', name, { backup_made_before_restoring: safety.name, sales: (doc.tables.sales || []).length });
  return { ok: true, restored: name, safety_backup: safety.name };
}

// A backup file brought from elsewhere (e.g. a USB stick), checked and added to the list.
async function upload(actor, buffer) {
  if (!actor.is_owner) throw forbidden('Only the owner can upload a backup file');
  if (!buffer?.length) throw bad('Choose a backup file');
  const doc = await read(buffer);
  const info = await writeFile('uploaded', buffer);
  await prune();
  await audit.record(actor, 'backup.uploaded', 'backup', info.name, { made: doc.created_at, sales: (doc.tables.sales || []).length });
  return info;
}

async function download(actor, name) {
  if (!actor.is_owner) throw forbidden('Only the owner can download backups');
  const file = filePath(name);
  await audit.record(actor, 'backup.downloaded', 'backup', name);
  return { data: await fsp.readFile(file), filename: name };
}

// Makes today's automatic backup if there isn't one yet.
async function dailyCheck() {
  try {
    const last = (await list()).find((b) => b.kind === 'auto');
    if (!last || last.created_at.slice(0, 10) !== today()) await create('auto');
    lastAutoError = null;
  } catch (err) {
    lastAutoError = { at: new Date().toISOString(), message: err.message };
    console.error('Automatic backup failed:', err.message);
  }
}

// Called once at startup.
function startSchedule() {
  setTimeout(dailyCheck, BACKUP_FIRST_CHECK_MS).unref();
  setInterval(dailyCheck, 3600e3).unref();
}

module.exports = { list, status, create, restore, upload, download, read, dailyCheck, startSchedule };
