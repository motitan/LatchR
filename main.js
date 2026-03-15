const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = __dirname;
const HOME_DIR = os.homedir();
const DESKTOP_DIR = path.join(HOME_DIR, 'Desktop');
const APP_NAME = 'LatchR';
// Legacy names remain supported so existing local workspaces and saved packages still open.
const LEGACY_APP_NAME = 'Sport Tagger';
const LATCHR_ROOT = path.join(HOME_DIR, 'LatchR');
const LEGACY_TAGGER_ROOT = path.join(HOME_DIR, 'Tagger');
const LATCHR_PROJECTS_DIR = path.join(LATCHR_ROOT, 'projects');
const LATCHR_TEMPLATES_DIR = path.join(LATCHR_ROOT, 'tag_templates');
const LATCHR_VIDEOS_DIR = path.join(LATCHR_ROOT, 'videos');
const LEGACY_TAGGER_PROJECTS_DIR = path.join(LEGACY_TAGGER_ROOT, 'projects');
const LEGACY_TAGGER_TEMPLATES_DIR = path.join(LEGACY_TAGGER_ROOT, 'tag_templates');
const LEGACY_TAGGER_VIDEOS_DIR = path.join(LEGACY_TAGGER_ROOT, 'videos');
const PROJECT_PACKAGE_EXT = '.latchr';
const LEGACY_PROJECT_PACKAGE_EXT = '.sporttagger';
const PROJECT_FILE_EXT = '.latchr.json';
const LEGACY_PROJECT_FILE_EXT = '.sporttagger.json';
const BACKUP_DIR_NAME = '_bak';
const EXPORT_ROOT = path.join(DESKTOP_DIR, 'video_prototype');
const VIDEO_METADATA_FILE = 'video_metadata.json';
const INVALID_NAME_RE = /[<>:"/\\|?*\x00-\x1f]+/g;
const IS_MACOS = process.platform === 'darwin';
const FINDER_INFO_ATTR = 'com.apple.FinderInfo';
const FINDER_INFO_BYTES = 32;
const FINDER_INFO_FLAG_OFFSET = 8;
const FINDER_FLAG_HAS_BUNDLE = 0x2000;
const PROJECT_PACKAGE_ICON_FILE = 'latchr-project.icns';
const LEGACY_PROJECT_PACKAGE_ICON_FILE = 'sporttagger-project.icns';
const PROJECT_SCHEMA_PREFIX = 'latchr';
const LEGACY_PROJECT_SCHEMA_PREFIX = 'sporttagger';
const SETFILE_BIN = '/usr/bin/SetFile';
const SIPS_BIN = '/usr/bin/sips';
const DEREZ_BIN = '/usr/bin/DeRez';
const REZ_BIN = '/usr/bin/Rez';
const PROJECT_PACKAGE_FLAG_CACHE = new Set();
const PROJECT_PACKAGE_ICON_CACHE = new Set();
let projectPackageBackfillPromise = null;
let projectPackageWarningShown = false;
let projectPackageIconSourceCache = '';

function uniqueValues(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function projectPackageExtensions() {
  return [PROJECT_PACKAGE_EXT, LEGACY_PROJECT_PACKAGE_EXT];
}

function projectFileExtensions() {
  return [PROJECT_FILE_EXT, LEGACY_PROJECT_FILE_EXT];
}

function stripKnownSuffix(value, suffixes) {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  for (const suffix of uniqueValues(suffixes).sort((a, b) => b.length - a.length)) {
    if (lower.endsWith(suffix.toLowerCase())) {
      return text.slice(0, text.length - suffix.length);
    }
  }
  return text;
}

function stripProjectFileExt(value) {
  return stripKnownSuffix(value, projectFileExtensions())
    .replace(/\.json$/i, '')
    .replace(/\.bak\.\d+$/i, '')
    .replace(/[. ]+$/g, '')
    .trim();
}

function hasProjectFileExtension(value) {
  const lower = String(value || '').trim().toLowerCase();
  return projectFileExtensions().some((ext) => lower.endsWith(ext.toLowerCase()));
}

function dirEntriesSync(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

function hasProjectPackages(dirPath) {
  return dirEntriesSync(dirPath).some((entry) => entry.isDirectory() && isProjectPackageDirName(entry.name));
}

function preferredProjectsDir() {
  if (hasProjectPackages(LATCHR_PROJECTS_DIR)) return LATCHR_PROJECTS_DIR;
  if (hasProjectPackages(LEGACY_TAGGER_PROJECTS_DIR)) return LEGACY_TAGGER_PROJECTS_DIR;
  return LATCHR_PROJECTS_DIR;
}

function preferredTemplatesDir() {
  if (listJsonFilesSync(LATCHR_TEMPLATES_DIR).length > 0) return LATCHR_TEMPLATES_DIR;
  if (listJsonFilesSync(LEGACY_TAGGER_TEMPLATES_DIR).length > 0) return LEGACY_TAGGER_TEMPLATES_DIR;
  return LATCHR_TEMPLATES_DIR;
}

function preferredWorkspaceRoot() {
  const templatesDir = preferredTemplatesDir();
  if (templatesDir === LEGACY_TAGGER_TEMPLATES_DIR) return LEGACY_TAGGER_ROOT;
  if (preferredProjectsDir() === LEGACY_TAGGER_PROJECTS_DIR) return LEGACY_TAGGER_ROOT;
  return LATCHR_ROOT;
}

function workspaceProjectDirs() {
  return uniqueValues([LATCHR_PROJECTS_DIR, LEGACY_TAGGER_PROJECTS_DIR]);
}

function preferredProjectDirForSave(currentProjectDir, projectName) {
  const currentDir = String(currentProjectDir || '').trim();
  if (!currentDir) return path.join(LATCHR_PROJECTS_DIR, projectPackageDirName(projectName));
  if (isInsideDir(LEGACY_TAGGER_PROJECTS_DIR, currentDir)) {
    return path.join(LATCHR_PROJECTS_DIR, projectPackageDirName(projectName));
  }
  if (isInsideDir(LATCHR_PROJECTS_DIR, currentDir) || isProjectPackageDirName(path.basename(currentDir))) {
    return path.join(path.dirname(currentDir), projectPackageDirName(projectName));
  }
  return path.join(path.dirname(currentDir), projectPackageDirName(projectName));
}

function schemaId(name) {
  return `${PROJECT_SCHEMA_PREFIX}.${name}`;
}

function legacySchemaId(name) {
  return `${LEGACY_PROJECT_SCHEMA_PREFIX}.${name}`;
}

function sanitizeName(value, fallback = 'clip') {
  const raw = String(value || '').trim();
  const cleaned = raw
    .replace(INVALID_NAME_RE, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || fallback;
}

function sanitizeTagSlug(value, fallback = 'event') {
  const base = sanitizeName(value, fallback).toLowerCase();
  const slug = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || fallback;
}

function sanitizeProjectFolderName(value, fallback = 'Project') {
  return sanitizeName(value, fallback);
}

function projectPackageDirName(value) {
  const cleaned = stripProjectPackageExt(sanitizeProjectFolderName(value, 'Project'))
    .replace(/[. ]+$/g, '')
    .trim();
  const stem = cleaned || 'Project';
  return `${stem}${PROJECT_PACKAGE_EXT}`;
}

function stripProjectPackageExt(value) {
  return stripKnownSuffix(value, projectPackageExtensions())
    .replace(/[. ]+$/g, '')
    .trim();
}

function projectFileNameFromName(value) {
  const cleaned = stripProjectFileExt(sanitizeName(value, 'project'))
    .replace(/[. ]+$/g, '')
    .trim();
  const stem = cleaned || 'project';
  return `${stem}${PROJECT_FILE_EXT}`;
}

function timelineFileNameFromName(value) {
  const cleaned = sanitizeName(value, 'timeline')
    .replace(/\.(?:latchr|sporttagger)\.json$/i, '')
    .replace(/\.(?:latchr|sporttagger)$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.bak\.\d+$/i, '')
    .replace(/[. ]+$/g, '')
    .trim();
  const stem = cleaned || 'timeline';
  return `${stem}.json`;
}

function isBackupJsonFileName(fileName) {
  return /\.bak\.\d+\.json$/i.test(String(fileName || '').toLowerCase());
}

function backupDirForFile(filePath) {
  return path.join(path.dirname(filePath), BACKUP_DIR_NAME);
}

function backupPathForFile(filePath, index) {
  const ext = path.extname(filePath) || '.json';
  const base = path.basename(filePath, ext);
  return path.join(backupDirForFile(filePath), `${base}.bak.${index}${ext}`);
}

function legacyBackupPathForFile(filePath, index) {
  const ext = path.extname(filePath) || '.json';
  const stem = filePath.slice(0, filePath.length - ext.length);
  return `${stem}.bak.${index}${ext}`;
}

function expandHomePath(input) {
  const text = String(input || '').trim();
  if (!text) return text;
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return text;
}

function resolvePathFromRoot(pathText) {
  const raw = String(pathText || '').trim();
  if (!raw) {
    throw new Error('path is required');
  }
  const expanded = expandHomePath(raw);
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return path.resolve(ROOT_DIR, expanded);
}

function normalizeSourcePathInput(pathText) {
  let raw = String(pathText || '').trim();
  if (!raw) return raw;
  raw = raw.replace(/\r/g, '\n');
  const cdMatch = raw.match(/(?:^|\n)\s*cd\s+([^\n]+)/);
  if (cdMatch) raw = cdMatch[1];
  raw = raw.replace(/\s*\n\s*/g, '');
  raw = raw.replace(/^["']|["']$/g, '').trim();
  raw = raw.replace(/\\ /g, ' ');
  return raw;
}

function isProjectPackageDirName(value) {
  const lower = String(value || '').trim().toLowerCase();
  return projectPackageExtensions().some((ext) => lower.endsWith(ext.toLowerCase()));
}

function normalizeFinderInfoHex(raw) {
  const compact = String(raw || '').replace(/[^a-fA-F0-9]/g, '');
  if (!compact) return '';
  return compact.length % 2 === 0 ? compact : compact.slice(0, compact.length - 1);
}

function warnProjectPackageMetadataOnce(message) {
  if (projectPackageWarningShown) return;
  projectPackageWarningShown = true;
  console.warn(`[project-package] ${String(message || '').trim()}`);
}

async function readFinderInfoBuffer(dirPath) {
  const out = await runCommand('/usr/bin/xattr', ['-px', FINDER_INFO_ATTR, dirPath]);
  if (out.code !== 0) return Buffer.alloc(FINDER_INFO_BYTES);
  const hex = normalizeFinderInfoHex(out.stdout);
  if (!hex) return Buffer.alloc(FINDER_INFO_BYTES);
  let finderInfo;
  try {
    finderInfo = Buffer.from(hex, 'hex');
  } catch (_) {
    return Buffer.alloc(FINDER_INFO_BYTES);
  }
  if (finderInfo.length === FINDER_INFO_BYTES) return finderInfo;
  const resized = Buffer.alloc(FINDER_INFO_BYTES);
  finderInfo.copy(resized, 0, 0, Math.min(finderInfo.length, FINDER_INFO_BYTES));
  return resized;
}

function projectPackageIconCandidates() {
  const out = [];
  out.push(path.join(ROOT_DIR, 'resources', PROJECT_PACKAGE_ICON_FILE));
  out.push(path.join(ROOT_DIR, 'resources', LEGACY_PROJECT_PACKAGE_ICON_FILE));
  if (process && typeof process.resourcesPath === 'string' && process.resourcesPath.trim()) {
    out.push(path.join(process.resourcesPath, PROJECT_PACKAGE_ICON_FILE));
    out.push(path.join(process.resourcesPath, LEGACY_PROJECT_PACKAGE_ICON_FILE));
  }
  for (const appName of [APP_NAME, LEGACY_APP_NAME]) {
    for (const iconFile of [PROJECT_PACKAGE_ICON_FILE, LEGACY_PROJECT_PACKAGE_ICON_FILE]) {
      out.push(path.join(ROOT_DIR, 'dist', `${appName}.app`, 'Contents', 'Resources', iconFile));
      out.push(path.join('/Applications', `${appName}.app`, 'Contents', 'Resources', iconFile));
    }
  }
  return uniqueValues(out);
}

function resolveProjectPackageIconSource() {
  if (projectPackageIconSourceCache && fs.existsSync(projectPackageIconSourceCache)) {
    return projectPackageIconSourceCache;
  }
  const candidates = projectPackageIconCandidates();
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      projectPackageIconSourceCache = candidate;
      return candidate;
    }
  }
  return '';
}

async function ensureProjectPackageCustomIcon(projectDir) {
  const dirPath = String(projectDir || '').trim();
  if (!IS_MACOS || !dirPath) return { ok: true, skipped: true };
  const resolvedDir = path.resolve(dirPath);
  if (!isProjectPackageDirName(path.basename(resolvedDir))) return { ok: true, skipped: true };
  if (PROJECT_PACKAGE_ICON_CACHE.has(resolvedDir)) return { ok: true, cached: true };
  if (!fs.existsSync(SETFILE_BIN)) {
    return { ok: false, error: `${SETFILE_BIN} not found; cannot apply custom package icon` };
  }
  if (!fs.existsSync(SIPS_BIN) || !fs.existsSync(DEREZ_BIN) || !fs.existsSync(REZ_BIN)) {
    return { ok: false, error: 'Required icon tools are missing (sips/DeRez/Rez)' };
  }

  const iconSource = resolveProjectPackageIconSource();
  if (!iconSource) {
    return { ok: false, error: `No project package icon source found (${PROJECT_PACKAGE_ICON_FILE})` };
  }

  const iconFilePath = path.join(resolvedDir, `Icon${String.fromCharCode(13)}`);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'latchr-icon-')).catch(() => '');
  if (!tmpDir) return { ok: false, error: 'Cannot create temp directory for package icon generation' };
  const tmpIconPath = path.join(tmpDir, PROJECT_PACKAGE_ICON_FILE);
  const tmpRsrcPath = path.join(tmpDir, 'icon.rsrc');

  try {
    await fsp.copyFile(iconSource, tmpIconPath);
  } catch (error) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    return { ok: false, error: `Cannot stage package icon for ${resolvedDir}: ${String(error && error.message ? error.message : error)}` };
  }

  const sipsOut = await runCommand(SIPS_BIN, ['-i', tmpIconPath]);
  if (sipsOut.code !== 0) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    const message = String(sipsOut.stderr || sipsOut.error || `sips exit code ${sipsOut.code}`).trim();
    return { ok: false, error: `Cannot index package icon for ${resolvedDir}: ${message}` };
  }

  const deRezOut = await runCommandBuffer(DEREZ_BIN, ['-only', 'icns', tmpIconPath], { maxStdoutBytes: 8 * 1024 * 1024 });
  if (deRezOut.code !== 0 || deRezOut.truncated || !deRezOut.stdout || deRezOut.stdout.length === 0) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    const message = String(deRezOut.stderr || deRezOut.error || `DeRez exit code ${deRezOut.code}`).trim();
    return { ok: false, error: `Cannot extract icon resources for ${resolvedDir}: ${message}` };
  }

  try {
    await fsp.writeFile(tmpRsrcPath, deRezOut.stdout);
    await fsp.unlink(iconFilePath).catch(() => { });
  } catch (error) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    return { ok: false, error: `Cannot prepare icon resource file for ${resolvedDir}: ${String(error && error.message ? error.message : error)}` };
  }

  const rezOut = await runCommand(REZ_BIN, ['-append', tmpRsrcPath, '-o', iconFilePath]);
  if (rezOut.code !== 0) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    const message = String(rezOut.stderr || rezOut.error || `Rez exit code ${rezOut.code}`).trim();
    return { ok: false, error: `Cannot write package icon resources for ${resolvedDir}: ${message}` };
  }

  const iconTypeOut = await runCommand(SETFILE_BIN, ['-t', 'icnC', '-c', 'MACS', iconFilePath]);
  if (iconTypeOut.code !== 0) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    const message = String(iconTypeOut.stderr || iconTypeOut.error || `SetFile exit code ${iconTypeOut.code}`).trim();
    return { ok: false, error: `Cannot set icon file type for ${resolvedDir}: ${message}` };
  }

  const hideOut = await runCommand(SETFILE_BIN, ['-a', 'V', iconFilePath]);
  if (hideOut.code !== 0) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    const message = String(hideOut.stderr || hideOut.error || `SetFile exit code ${hideOut.code}`).trim();
    return { ok: false, error: `Cannot hide package icon file for ${resolvedDir}: ${message}` };
  }

  const markOut = await runCommand(SETFILE_BIN, ['-a', 'C', resolvedDir]);
  if (markOut.code !== 0) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    const message = String(markOut.stderr || markOut.error || `SetFile exit code ${markOut.code}`).trim();
    return { ok: false, error: `Cannot set custom icon flag for ${resolvedDir}: ${message}` };
  }

  await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
  PROJECT_PACKAGE_ICON_CACHE.add(resolvedDir);
  return { ok: true, updated: true };
}

async function ensureProjectPackageFlag(projectDir) {
  const dirPath = String(projectDir || '').trim();
  if (!IS_MACOS || !dirPath) return { ok: true, skipped: true };
  const resolvedDir = path.resolve(dirPath);
  if (!isProjectPackageDirName(path.basename(resolvedDir))) return { ok: true, skipped: true };

  let stat;
  try {
    stat = await fsp.stat(resolvedDir);
  } catch (error) {
    return { ok: false, error: `Cannot stat project package dir: ${String(error && error.message ? error.message : error)}` };
  }
  if (!stat.isDirectory()) return { ok: false, error: `Not a directory: ${resolvedDir}` };

  if (!PROJECT_PACKAGE_FLAG_CACHE.has(resolvedDir)) {
    const finderInfo = await readFinderInfoBuffer(resolvedDir);
    if (finderInfo.length < FINDER_INFO_BYTES) {
      return { ok: false, error: `Invalid FinderInfo length for: ${resolvedDir}` };
    }
    const existingFlags = finderInfo.readUInt16BE(FINDER_INFO_FLAG_OFFSET);
    if ((existingFlags & FINDER_FLAG_HAS_BUNDLE) !== FINDER_FLAG_HAS_BUNDLE) {
      finderInfo.writeUInt16BE(existingFlags | FINDER_FLAG_HAS_BUNDLE, FINDER_INFO_FLAG_OFFSET);
      const writeOut = await runCommand('/usr/bin/xattr', ['-wx', FINDER_INFO_ATTR, finderInfo.toString('hex'), resolvedDir]);
      if (writeOut.code !== 0) {
        const message = String(writeOut.stderr || writeOut.error || `xattr exit code ${writeOut.code}`).trim();
        return { ok: false, error: `Cannot write Finder package flag for ${resolvedDir}: ${message}` };
      }
    }
    PROJECT_PACKAGE_FLAG_CACHE.add(resolvedDir);
  }

  const iconMarked = await ensureProjectPackageCustomIcon(resolvedDir);
  if (!iconMarked.ok) return iconMarked;
  return { ok: true, updated: true };
}

function findProjectPackageDirFromPath(pathText) {
  const raw = String(pathText || '').trim();
  if (!raw) return '';
  let cursor = path.resolve(raw);
  try {
    const stat = fs.statSync(cursor);
    if (!stat.isDirectory()) cursor = path.dirname(cursor);
  } catch (_) {
    cursor = path.dirname(cursor);
  }

  while (true) {
    if (isProjectPackageDirName(path.basename(cursor))) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return '';
    cursor = parent;
  }
}

async function backfillProjectPackageFlags() {
  if (!IS_MACOS) return;
  if (projectPackageBackfillPromise) {
    await projectPackageBackfillPromise;
    return;
  }

  projectPackageBackfillPromise = (async () => {
    for (const projectsDir of workspaceProjectDirs()) {
      const entries = await fsp.readdir(projectsDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!isProjectPackageDirName(entry.name)) continue;
        const marked = await ensureProjectPackageFlag(path.join(projectsDir, entry.name));
        if (!marked.ok && marked.error) warnProjectPackageMetadataOnce(marked.error);
      }
    }
  })();

  await projectPackageBackfillPromise;
}

async function existsFile(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch (_) {
    return false;
  }
}

async function existsPath(entryPath) {
  try {
    await fsp.access(entryPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureLatchrWorkspace() {
  await fsp.mkdir(LATCHR_ROOT, { recursive: true });
  await fsp.mkdir(LATCHR_PROJECTS_DIR, { recursive: true });
  await fsp.mkdir(LATCHR_TEMPLATES_DIR, { recursive: true });
  await fsp.mkdir(LATCHR_VIDEOS_DIR, { recursive: true });
  await fsp.mkdir(EXPORT_ROOT, { recursive: true });
  await backfillProjectPackageFlags().catch((error) => {
    warnProjectPackageMetadataOnce(String(error && error.message ? error.message : error));
  });
}

async function readJsonFileSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return { ok: true, raw, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

function detectJsonPayloadType(data) {
  if (Array.isArray(data)) return 'timeline';
  if (!data || typeof data !== 'object') return 'unknown';

  const hasTemplateKeys =
    Array.isArray(data.tags) &&
    (
      Array.isArray(data.labels) ||
      Array.isArray(data['event-pages']) ||
      !!data['event-window'] ||
      Array.isArray(data['tagging-pages']) ||
      !!data['tagging-window']
    );
  if (hasTemplateKeys) return 'template';

  const hasSessionTimeline = !!data.session && Array.isArray(data.tags);
  if (hasSessionTimeline) return 'timeline';

  const hasEventsArray = Array.isArray(data.events);
  if (hasEventsArray) {
    const looksLikeProject =
      typeof data.project_version !== 'undefined' ||
      typeof data.project_name !== 'undefined' ||
      typeof data.video_path !== 'undefined' ||
      typeof data.template_path !== 'undefined' ||
      typeof data.timeline_path !== 'undefined';
    return looksLikeProject ? 'project' : 'timeline';
  }

  return 'unknown';
}

function normalizeTemplateSchemaKeys(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  let text = '';
  try {
    text = JSON.stringify(raw);
  } catch (_) {
    return raw;
  }
  const migrated = text
    .replace(/"tagging-pages":/g, '"event-pages":')
    .replace(/"tagging-window-items-extra-pages":/g, '"event-window-items-extra-pages":')
    .replace(/"tagging-window-items":/g, '"event-window-items":')
    .replace(/"tagging-window-item/g, '"event-window-item')
    .replace(/"tagging-window-canvas_/g, '"event-window-canvas_')
    .replace(/"tagging-window":/g, '"event-window":');
  if (migrated === text) return raw;
  try {
    return JSON.parse(migrated);
  } catch (_) {
    return raw;
  }
}

async function detectJsonFileType(pathText) {
  const resolved = resolvePathFromRoot(pathText);
  if (path.extname(resolved).toLowerCase() !== '.json') return { ok: true, kind: 'unknown', path: resolved };
  const parsed = await readJsonFileSafe(resolved);
  if (!parsed.ok) return { ok: false, error: `Invalid JSON file: ${parsed.error}` };
  return { ok: true, kind: detectJsonPayloadType(parsed.data), path: resolved };
}

async function findExistingJsonByExactContent(sourcePath, targetDir) {
  if (path.extname(sourcePath).toLowerCase() !== '.json') return '';
  const parsedSource = await readJsonFileSafe(sourcePath);
  if (!parsedSource.ok) return '';
  const srcText = parsedSource.raw.trim();

  const entries = await fsp.readdir(targetDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== '.json') continue;
    const candidatePath = path.join(targetDir, entry.name);
    if (path.resolve(candidatePath) === path.resolve(sourcePath)) continue;
    const parsedCandidate = await readJsonFileSafe(candidatePath);
    if (!parsedCandidate.ok) continue;
    if (parsedCandidate.raw.trim() === srcText) return candidatePath;
  }
  return '';
}

function listJsonFilesSync(dirPath) {
  const out = [];
  if (!fs.existsSync(dirPath)) return out;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = String(entry.name || '').toLowerCase();
    if (!lower.endsWith('.json')) continue;
    if (isBackupJsonFileName(lower)) continue;
    if (lower.endsWith('.snapshot.json')) continue;
    if (lower.endsWith('.manifest.json')) continue;
    out.push({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function isTimelineJsonFileName(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (!lower.endsWith('.json')) return false;
  if (lower.endsWith('.snapshot.json')) return false;
  if (lower.endsWith('.manifest.json')) return false;
  if (isBackupJsonFileName(lower)) return false;
  return true;
}

function listTimelineFilesSync(dirPath) {
  const out = [];
  if (!fs.existsSync(dirPath)) return out;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isTimelineJsonFileName(entry.name)) continue;
    out.push({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function uniquePathIfExists(basePath) {
  if (!fs.existsSync(basePath)) return basePath;
  const ext = path.extname(basePath);
  const stem = path.basename(basePath, ext);
  const dir = path.dirname(basePath);
  for (let i = 2; i < 10000; i += 1) {
    const candidate = path.join(dir, `${stem}_${String(i).padStart(3, '0')}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${stem}_${Date.now()}${ext}`);
}

function clampColorComponent(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function normalizeEventLabels(labels) {
  if (!Array.isArray(labels)) return [];
  const out = [];
  for (const raw of labels) {
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) continue;
      out.push({ text });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const text = String(raw.text || raw.label || '').trim();
    if (!text) continue;
    const group = String(raw.group || '').trim();
    if (group) out.push({ text, group });
    else out.push({ text });
  }
  return out;
}

function normalizePitchXY(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out = {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
  };
  const xNorm = Number(raw.x_norm);
  const yNorm = Number(raw.y_norm);
  if (Number.isFinite(xNorm)) out.x_norm = Number(Math.max(0, Math.min(1, xNorm)).toFixed(6));
  if (Number.isFinite(yNorm)) out.y_norm = Number(Math.max(0, Math.min(1, yNorm)).toFixed(6));
  const x2 = Number(raw.x2);
  const y2 = Number(raw.y2);
  if (Number.isFinite(x2) && Number.isFinite(y2)) {
    out.x2 = Number(x2.toFixed(3));
    out.y2 = Number(y2.toFixed(3));
    const x2Norm = Number(raw.x2_norm);
    const y2Norm = Number(raw.y2_norm);
    if (Number.isFinite(x2Norm)) out.x2_norm = Number(Math.max(0, Math.min(1, x2Norm)).toFixed(6));
    if (Number.isFinite(y2Norm)) out.y2_norm = Number(Math.max(0, Math.min(1, y2Norm)).toFixed(6));
  }
  const canvasWidth = Number(raw.canvas_width);
  const canvasHeight = Number(raw.canvas_height);
  if (Number.isFinite(canvasWidth) && canvasWidth > 0) out.canvas_width = Number(canvasWidth.toFixed(3));
  if (Number.isFinite(canvasHeight) && canvasHeight > 0) out.canvas_height = Number(canvasHeight.toFixed(3));
  const pageIndex = Number(raw.page_index);
  if (Number.isFinite(pageIndex)) out.page_index = Math.round(pageIndex);
  const pageName = String(raw.page_name || '').trim();
  if (pageName) out.page_name = pageName;
  return out;
}

function normalizeTimelineEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) {
    return { ok: false, error: 'Timeline events must be an array' };
  }

  const issues = [];
  const out = [];
  const idCounts = new Map();

  function nextUniqueId(seed, index) {
    const baseRaw = String(seed || '').trim() || `evt_${index + 1}`;
    const seen = idCounts.get(baseRaw) || 0;
    idCounts.set(baseRaw, seen + 1);
    return seen === 0 ? baseRaw : `${baseRaw}_${seen + 1}`;
  }

  for (let i = 0; i < rawEvents.length; i += 1) {
    const raw = rawEvents[i];
    if (!raw || typeof raw !== 'object') {
      issues.push(`Event #${i + 1}: must be an object`);
      continue;
    }

    const start = Number(raw.start);
    const end = Number(raw.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      issues.push(`Event #${i + 1}: start/end must be numbers`);
      continue;
    }

    const name = String(raw.name || raw.label || '').trim() || 'Event';
    const period = String(raw.period || '').trim();
    const labels = normalizeEventLabels(raw.labels);
    const colorRaw = Array.isArray(raw.color) ? raw.color : [];
    const color = [
      clampColorComponent(colorRaw[0], 38),
      clampColorComponent(colorRaw[1], 79),
      clampColorComponent(colorRaw[2], 130),
    ];

    const eventId = nextUniqueId(raw.id, i);
    const refName = String(raw.ref_name || raw.tag_short_name || '').trim();
    const labelRefNamesRaw = Array.isArray(raw.label_ref_names) ? raw.label_ref_names : [];
    const labelRefNames = labelRefNamesRaw
      .map((v) => String(v || '').trim())
      .filter((v) => v.length > 0);
    const pitchXY = normalizePitchXY(raw.pitch_xy);

    const event = {
      id: eventId,
      name,
      start: Number(start.toFixed(3)),
      end: Number((end <= start ? start + 0.1 : end).toFixed(3)),
      period,
      labels,
      color,
    };
    if (refName) event.ref_name = refName;
    if (labelRefNames.length) event.label_ref_names = [...new Set(labelRefNames)];
    if (pitchXY) event.pitch_xy = pitchXY;
    out.push(event);
  }

  out.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return String(a.id).localeCompare(String(b.id));
  });

  if (issues.length > 0) {
    return { ok: true, events: out, warning: `Dropped ${issues.length} invalid event(s)` };
  }
  return { ok: true, events: out };
}

function parsePeriodStart(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || typeof value === 'undefined') return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 3) return NaN;
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  if (parts.length === 1) return Number(parts[0]);
  if (parts.length === 2) return (Number(parts[0]) * 60) + Number(parts[1]);
  return (Number(parts[0]) * 3600) + (Number(parts[1]) * 60) + Number(parts[2]);
}

function normalizeTimelinePeriods(rawPeriods) {
  if (!Array.isArray(rawPeriods)) {
    return { ok: true, periods: [] };
  }
  const issues = [];
  const out = [];
  const seen = new Set();

  for (let i = 0; i < rawPeriods.length; i += 1) {
    const raw = rawPeriods[i];
    if (!raw || typeof raw !== 'object') {
      issues.push(`Period #${i + 1}: must be an object`);
      continue;
    }
    const name = String(raw.id || raw.name || raw.period_id || `Period ${i + 1}`).trim() || `Period ${i + 1}`;
    const startRaw = raw.start ?? raw.start_sec ?? raw.time_sec ?? raw.time;
    const start = parsePeriodStart(startRaw);
    if (!Number.isFinite(start)) {
      issues.push(`Period #${i + 1}: start must be numeric seconds or HH:MM:SS`);
      continue;
    }
    const sec = Math.max(0, Number(start.toFixed(3)));
    const key = `${name.toLowerCase()}|${sec.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: name, start: sec });
  }

  if (issues.length > 0) {
    const preview = issues.slice(0, 8).join(' | ');
    const suffix = issues.length > 8 ? ` | +${issues.length - 8} more` : '';
    return { ok: false, error: `Timeline periods validation failed: ${preview}${suffix}` };
  }

  out.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return String(a.id).localeCompare(String(b.id));
  });

  return { ok: true, periods: out };
}

function sha256Json(value) {
  const payload = JSON.stringify(value);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function timelineCompanionPaths(timelinePath) {
  const ext = path.extname(timelinePath);
  const stem = timelinePath.slice(0, timelinePath.length - ext.length);
  return {
    snapshot: `${stem}.snapshot.json`,
    manifest: `${stem}.manifest.json`,
    backup1: backupPathForFile(timelinePath, 1),
    backup2: backupPathForFile(timelinePath, 2),
    backup3: backupPathForFile(timelinePath, 3),
    legacy_backup1: legacyBackupPathForFile(timelinePath, 1),
    legacy_backup2: legacyBackupPathForFile(timelinePath, 2),
    legacy_backup3: legacyBackupPathForFile(timelinePath, 3),
  };
}

function buildTimelineCanonicalPayload(timelinePath, events, periods) {
  const nowIso = new Date().toISOString();
  const eventHash = sha256Json(events);
  const periodHash = sha256Json(periods);
  return {
    timeline_schema: schemaId('timeline.v2'),
    timeline_saved_at: nowIso,
    timeline_name: path.basename(timelinePath, path.extname(timelinePath)),
    event_count: events.length,
    period_count: periods.length,
    event_sha256: eventHash,
    period_sha256: periodHash,
    periods,
    events,
  };
}

function buildTimelineSnapshotPayload(timelinePath, events, periods, canonical) {
  return {
    snapshot_schema: schemaId('timeline.snapshot.v2'),
    snapshot_saved_at: canonical.timeline_saved_at,
    source_timeline: path.basename(timelinePath),
    event_count: events.length,
    period_count: periods.length,
    event_sha256: canonical.event_sha256,
    period_sha256: canonical.period_sha256,
    periods,
    events,
  };
}

function buildTimelineManifestPayload(timelinePath, events, periods, canonical) {
  const minStart = events.length ? events[0].start : 0;
  const maxEnd = events.length ? events[events.length - 1].end : 0;
  const minPeriod = periods.length ? periods[0].start : 0;
  const maxPeriod = periods.length ? periods[periods.length - 1].start : 0;
  return {
    manifest_schema: schemaId('timeline.manifest.v2'),
    manifest_saved_at: canonical.timeline_saved_at,
    timeline_file: path.basename(timelinePath),
    timeline_schema: canonical.timeline_schema,
    event_count: canonical.event_count,
    period_count: canonical.period_count,
    min_start_sec: minStart,
    max_end_sec: maxEnd,
    min_period_start_sec: minPeriod,
    max_period_start_sec: maxPeriod,
    event_sha256: canonical.event_sha256,
    period_sha256: canonical.period_sha256,
  };
}

async function rotateJsonBackups(targetPath, backupLimit = 3) {
  const limit = Math.max(1, Math.min(99, Math.trunc(Number(backupLimit) || 3)));
  await fsp.mkdir(backupDirForFile(targetPath), { recursive: true });

  // Migrate old same-folder backups into _bak to keep project folders clean.
  for (let i = 1; i <= 99; i += 1) {
    const legacy = legacyBackupPathForFile(targetPath, i);
    if (!(await existsFile(legacy))) continue;
    const next = backupPathForFile(targetPath, i);
    if (await existsFile(next)) {
      await fsp.unlink(legacy).catch(() => { });
    } else {
      await fsp.rename(legacy, next).catch(() => { });
    }
  }

  for (let i = limit; i >= 1; i -= 1) {
    const src = backupPathForFile(targetPath, i);
    if (!(await existsFile(src))) continue;
    if (i === limit) {
      await fsp.unlink(src).catch(() => { });
      continue;
    }
    const dst = backupPathForFile(targetPath, i + 1);
    await fsp.rename(src, dst).catch(() => { });
  }

  if (await existsFile(targetPath)) {
    await fsp.copyFile(targetPath, backupPathForFile(targetPath, 1));
  }
}

async function writeJsonAtomic(targetPath, data, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const backupExisting = !!opts.backupExisting;
  const backupLimit = Number.isFinite(Number(opts.backupLimit)) ? Number(opts.backupLimit) : 3;
  const jsonText = `${JSON.stringify(data, null, 2)}\n`;
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const packageDir = findProjectPackageDirFromPath(targetPath);
  if (packageDir) {
    const marked = await ensureProjectPackageFlag(packageDir).catch((error) => (
      { ok: false, error: String(error && error.message ? error.message : error) }
    ));
    if (marked && !marked.ok && marked.error) warnProjectPackageMetadataOnce(marked.error);
  }
  if (backupExisting && (await existsFile(targetPath))) {
    await rotateJsonBackups(targetPath, backupLimit);
  }

  const fh = await fsp.open(tmpPath, 'w');
  try {
    await fh.writeFile(jsonText, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmpPath, targetPath);
}

async function writeTimelineArtifacts(targetPath, normalizedEvents, normalizedPeriods) {
  const canonical = buildTimelineCanonicalPayload(targetPath, normalizedEvents, normalizedPeriods);
  const companions = timelineCompanionPaths(targetPath);
  const snapshot = buildTimelineSnapshotPayload(targetPath, normalizedEvents, normalizedPeriods, canonical);
  const manifest = buildTimelineManifestPayload(targetPath, normalizedEvents, normalizedPeriods, canonical);

  await writeJsonAtomic(targetPath, canonical, { backupExisting: true, backupLimit: 3 });
  await writeJsonAtomic(companions.snapshot, snapshot, { backupExisting: false });
  await writeJsonAtomic(companions.manifest, manifest, { backupExisting: false });

  return { canonical, companions };
}

async function importAsset(sourcePathText, targetDir, mode = 'copy', options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const sourceResolved = resolvePathFromRoot(sourcePathText);
  const stat = await fsp.stat(sourceResolved).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new Error(`File not found: ${sourceResolved}`);
  }

  await fsp.mkdir(targetDir, { recursive: true });
  const fileName = sanitizeName(path.basename(sourceResolved), path.basename(sourceResolved));
  let targetPath = path.join(targetDir, fileName);
  if (path.resolve(sourceResolved) === path.resolve(targetPath)) {
    return targetPath;
  }
  if (opts.preferExistingByName && fs.existsSync(targetPath)) {
    return targetPath;
  }
  if (opts.dedupeByExactJson) {
    const existingByJson = await findExistingJsonByExactContent(sourceResolved, targetDir);
    if (existingByJson) return existingByJson;
  }

  targetPath = uniquePathIfExists(targetPath);
  if (mode === 'move') {
    try {
      await fsp.rename(sourceResolved, targetPath);
    } catch (error) {
      if (String(error && error.code) === 'EXDEV') {
        await fsp.copyFile(sourceResolved, targetPath);
        await fsp.unlink(sourceResolved);
      } else {
        throw error;
      }
    }
  } else {
    await fsp.copyFile(sourceResolved, targetPath);
  }
  return targetPath;
}

function normalizeTemplateImageRef(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function isTemplateImageRefExternal(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /^https?:\/\//i.test(text) || /^data:image\//i.test(text) || /^blob:/i.test(text);
}

function sourcePathFromFileUrl(fileUrlText) {
  const text = String(fileUrlText || '').trim();
  if (!/^file:\/\//i.test(text)) return '';
  try {
    const u = new URL(text);
    if (!u || u.protocol !== 'file:') return '';
    return path.resolve(decodeURIComponent(u.pathname || ''));
  } catch (_) {
    return '';
  }
}

function sourceTemplateProjectDirFromPath(sourceTemplatePathText) {
  const src = String(sourceTemplatePathText || '').trim();
  if (!src) return '';
  const sourceDir = path.dirname(src);
  if (path.basename(sourceDir).toLowerCase() === 'tag_templates') {
    return path.dirname(sourceDir);
  }
  return '';
}

function resolveTemplateImageSourcePath(imagePathText, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const raw = normalizeTemplateImageRef(imagePathText);
  if (!raw || isTemplateImageRefExternal(raw)) return '';

  const fromFileUrl = sourcePathFromFileUrl(raw);
  if (fromFileUrl) return fromFileUrl;

  const expanded = expandHomePath(raw);
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }

  const candidates = [];
  const seen = new Set();
  const addCandidate = (candidatePath) => {
    const candidateText = String(candidatePath || '').trim();
    if (!candidateText) return;
    const abs = path.resolve(candidateText);
    if (seen.has(abs)) return;
    seen.add(abs);
    candidates.push(abs);
  };
  const sourceTemplatePathRaw = String(opts.source_template_path || '').trim();
  if (sourceTemplatePathRaw) {
    let sourceTemplatePath = sourceTemplatePathRaw;
    try {
      sourceTemplatePath = resolvePathFromRoot(sourceTemplatePathRaw);
    } catch (_) {
      sourceTemplatePath = path.resolve(expandHomePath(sourceTemplatePathRaw));
    }
    addCandidate(path.join(path.dirname(sourceTemplatePath), expanded));
    const sourceProjectDir = sourceTemplateProjectDirFromPath(sourceTemplatePath);
    if (sourceProjectDir) addCandidate(path.join(sourceProjectDir, expanded));
  }

  const projectDirRaw = String(opts.project_dir || '').trim();
  if (projectDirRaw) {
    const projectDir = path.resolve(expandHomePath(projectDirRaw));
    addCandidate(path.join(projectDir, expanded));
    addCandidate(path.join(projectDir, 'tag_templates', expanded));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] || path.resolve(expanded);
}

function collectTemplateImageRefs(templateData) {
  const source = normalizeTemplateSchemaKeys(templateData);
  const refs = [];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return refs;

  const pages = Array.isArray(source['event-pages']) ? source['event-pages'] : [];
  pages.forEach((page, i) => {
    if (!page || typeof page !== 'object') return;
    refs.push({
      label: `page ${i + 1} background`,
      get: () => String(page['template_page-background_image_path'] || page['template_page-background_image'] || '').trim(),
      set: (value) => {
        page['template_page-background_image_path'] = String(value || '').trim();
      },
    });
  });

  const tw = (source['event-window'] && typeof source['event-window'] === 'object')
    ? source['event-window']
    : {};
  const allItems = [
    ...(Array.isArray(tw['event-window-items']) ? tw['event-window-items'] : []),
    ...(Array.isArray(tw['event-window-items-extra-pages']) ? tw['event-window-items-extra-pages'] : []),
  ];
  allItems.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    refs.push({
      label: `button ${i + 1} image`,
      get: () => String(item['event-window-item-button_image_path'] || item['event-window-item-button_image'] || '').trim(),
      set: (value) => {
        item['event-window-item-button_image_path'] = String(value || '').trim();
      },
    });
  });
  return refs;
}

async function materializeTemplateImageAssets(templateData, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const data = JSON.parse(JSON.stringify(normalizeTemplateSchemaKeys(templateData) || {}));
  const projectDirRaw = String(opts.project_dir || '').trim();
  if (!projectDirRaw) {
    return { ok: true, data, copied: [], warnings: [] };
  }

  const projectDir = path.resolve(expandHomePath(projectDirRaw));
  const assetsDir = path.join(projectDir, 'assets', 'images');
  await fsp.mkdir(assetsDir, { recursive: true });

  const refs = collectTemplateImageRefs(data);
  if (!refs.length) {
    return { ok: true, data, copied: [], warnings: [] };
  }

  const copied = [];
  const warnings = [];
  const sourceToRelative = new Map();

  for (const ref of refs) {
    const raw = normalizeTemplateImageRef(ref.get());
    if (!raw) {
      ref.set('');
      continue;
    }
    if (isTemplateImageRefExternal(raw)) {
      ref.set(raw);
      continue;
    }

    const resolvedSource = resolveTemplateImageSourcePath(raw, {
      source_template_path: opts.source_template_path || '',
      project_dir: projectDir,
    });
    if (!resolvedSource) {
      warnings.push(`${ref.label}: cannot resolve path "${raw}"`);
      ref.set(raw);
      continue;
    }

    let stat = null;
    try {
      stat = fs.statSync(resolvedSource);
    } catch (_) {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      warnings.push(`${ref.label}: file not found "${raw}"`);
      ref.set(raw);
      continue;
    }

    const sourceAbs = path.resolve(resolvedSource);
    let relativeTarget = sourceToRelative.get(sourceAbs) || '';
    if (!relativeTarget) {
      let targetAbs = '';
      if (isInsideDir(assetsDir, sourceAbs)) {
        targetAbs = sourceAbs;
      } else {
        const baseName = sanitizeName(path.basename(sourceAbs), path.basename(sourceAbs));
        targetAbs = uniquePathIfExists(path.join(assetsDir, baseName));
        await fsp.copyFile(sourceAbs, targetAbs);
        copied.push({ source: sourceAbs, target: targetAbs });
      }
      relativeTarget = path.relative(projectDir, targetAbs).replace(/\\/g, '/');
      sourceToRelative.set(sourceAbs, relativeTarget);
    }
    ref.set(relativeTarget);
  }

  return { ok: true, data, copied, warnings };
}

async function rewriteTemplateFileWithProjectAssets(templatePath, options = {}) {
  const parsed = await readJsonFileSafe(templatePath);
  if (!parsed.ok) {
    return { ok: false, error: `Template JSON read error: ${parsed.error}` };
  }
  const next = await materializeTemplateImageAssets(parsed.data, options);
  if (!next.ok) return next;
  await writeJsonAtomic(templatePath, next.data, { backupExisting: true, backupLimit: 2 });
  return next;
}

async function resolveProjectTimelineWorkspace(projectPathText) {
  const raw = String(projectPathText || '').trim();
  if (!raw) return { ok: false, error: 'project_path is required' };

  let projectPath;
  try {
    projectPath = resolvePathFromRoot(raw);
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }

  const projectDir = path.dirname(projectPath);
  const timelinesDir = path.join(projectDir, 'timelines');
  try {
    await fsp.mkdir(timelinesDir, { recursive: true });
  } catch (error) {
    return { ok: false, error: `Cannot create timelines folder: ${String(error && error.message ? error.message : error)}` };
  }

  return {
    ok: true,
    project_path: projectPath,
    project_dir: projectDir,
    timelines_dir: timelinesDir,
  };
}

function resolveProjectDirFromPath(projectPathText) {
  const projectPath = resolvePathFromRoot(projectPathText);
  let projectDir = path.dirname(projectPath);
  try {
    if (fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory()) {
      projectDir = projectPath;
    }
  } catch (_) { }
  return { project_path: projectPath, project_dir: projectDir };
}

function resolveStoredAbsolutePath(pathText) {
  const raw = String(pathText || '').trim();
  if (!raw) return '';
  const expanded = expandHomePath(raw);
  if (!path.isAbsolute(expanded)) return '';
  return path.resolve(expanded);
}

function resolvedPathText(pathText) {
  return path.resolve(String(pathText || '').trim());
}

function sameResolvedPath(a, b) {
  return resolvedPathText(a) === resolvedPathText(b);
}

function sameFilesystemPath(a, b) {
  if (sameResolvedPath(a, b)) return true;
  if (!IS_MACOS) return false;
  return resolvedPathText(a).toLowerCase() === resolvedPathText(b).toLowerCase();
}

function relocateProjectLocalPath(pathText, fromProjectDir, toProjectDir) {
  const raw = String(pathText || '').trim();
  if (!raw) return '';
  const fromDir = String(fromProjectDir || '').trim();
  const toDir = String(toProjectDir || '').trim();
  if (!fromDir || !toDir) return raw;
  const resolved = resolveStoredAbsolutePath(raw);
  if (!resolved || !isInsideDir(fromDir, resolved)) return raw;
  return path.join(path.resolve(toDir), path.relative(path.resolve(fromDir), resolved));
}

function rewriteProjectLocalSaveData(data, fromProjectDir, toProjectDir, projectName) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const next = { ...source };
  next.project_name = sanitizeProjectFolderName(projectName || next.project_name || 'Project', 'Project');
  for (const key of ['video_path', 'video_metadata_path', 'template_path', 'timeline_path']) {
    if (typeof next[key] !== 'string') continue;
    next[key] = relocateProjectLocalPath(next[key], fromProjectDir, toProjectDir);
  }
  return next;
}

async function syncProjectVideoMetadataManifest(projectPathText, manifestPathText) {
  const projectPath = String(projectPathText || '').trim();
  const manifestPath = resolveStoredAbsolutePath(manifestPathText);
  if (!projectPath || !manifestPath) return { ok: true, skipped: true };

  const resolved = resolveProjectDirFromPath(projectPath);
  if (!isInsideDir(resolved.project_dir, manifestPath)) return { ok: true, skipped: true };
  if (!(await existsFile(manifestPath))) return { ok: true, skipped: true };

  let raw;
  try {
    raw = await fsp.readFile(manifestPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `Cannot read video metadata manifest: ${String(error && error.message ? error.message : error)}` };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `Invalid video metadata manifest JSON: ${String(error && error.message ? error.message : error)}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Video metadata manifest must be a JSON object' };
  }

  data.project_file = path.basename(projectPath);
  data.manifest_schema = schemaId('video_metadata.v1');
  data.manifest_saved_at = new Date().toISOString();
  try {
    await writeJsonAtomic(manifestPath, data, { backupExisting: true, backupLimit: 2 });
  } catch (error) {
    return { ok: false, error: `Cannot update video metadata manifest: ${String(error && error.message ? error.message : error)}` };
  }
  return { ok: true, path: manifestPath };
}

async function writeVideoMetadataManifest(projectPathText, metadata) {
  const resolved = resolveProjectDirFromPath(projectPathText);
  await fsp.mkdir(resolved.project_dir, { recursive: true });
  const manifestPath = path.join(resolved.project_dir, VIDEO_METADATA_FILE);
  const payload = {
    manifest_schema: schemaId('video_metadata.v1'),
    manifest_saved_at: new Date().toISOString(),
    project_file: path.basename(String(resolved.project_path || '').trim()),
    ...metadata,
  };
  await writeJsonAtomic(manifestPath, payload, { backupExisting: true, backupLimit: 2 });
  return manifestPath;
}

async function handleListTagTemplates() {
  await ensureLatchrWorkspace();
  const templatesDir = preferredTemplatesDir();
  return {
    ok: true,
    root: preferredWorkspaceRoot(),
    templates_dir: templatesDir,
    templates: listJsonFilesSync(templatesDir),
  };
}

async function handleProvisionProject(payload) {
  await ensureLatchrWorkspace();
  const data = payload && typeof payload === 'object' ? payload : {};
  const videoModeRaw = String(data.video_import_mode || '').trim().toLowerCase();
  const videoMode = videoModeRaw === 'move' ? 'move' : 'copy';

  let projectName = String(data.project_name || '').trim();
  const projectPathRaw = String(data.project_path || '').trim();
  let projectPath = '';
  let projectDir = '';

  if (projectPathRaw) {
    try {
      projectPath = resolvePathFromRoot(projectPathRaw);
      projectDir = path.dirname(projectPath);
      if (!projectName) {
        const fromFile = stripProjectFileExt(path.basename(projectPath));
        const fromDir = stripProjectPackageExt(path.basename(projectDir));
        projectName = sanitizeProjectFolderName(fromFile || fromDir || 'Project', 'Project');
      }
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
  }

  if (!projectName) projectName = 'Project';
  if (!projectDir) {
    const projectDirName = projectPackageDirName(projectName);
    projectDir = path.join(LATCHR_PROJECTS_DIR, projectDirName);
    projectPath = path.join(projectDir, projectFileNameFromName(projectName));
  }
  if (!projectPath) {
    projectPath = path.join(projectDir, projectFileNameFromName(projectName));
  }

  const projectSlug = sanitizeTagSlug(projectName, 'project');
  const projectVideoDir = path.join(projectDir, 'video');
  const projectTimelineDir = path.join(projectDir, 'timelines');
  const projectTemplateDir = path.join(projectDir, 'tag_templates');
  await fsp.mkdir(projectVideoDir, { recursive: true });
  await fsp.mkdir(projectTimelineDir, { recursive: true });
  await fsp.mkdir(projectTemplateDir, { recursive: true });
  const markedProject = await ensureProjectPackageFlag(projectDir).catch((error) => (
    { ok: false, error: String(error && error.message ? error.message : error) }
  ));
  if (markedProject && !markedProject.ok && markedProject.error) {
    warnProjectPackageMetadataOnce(markedProject.error);
  }

  let videoPath = '';
  let timelinePath = '';
  let templatePath = '';
  const warnings = [];

  const videoInput = String(data.video_path || '').trim();
  let timelineInput = String(data.timeline_path || '').trim();
  let templateInput = String(data.template_path || '').trim();

  const detectCache = new Map();
  async function detectCached(pathText) {
    const key = String(pathText || '').trim();
    if (!key) return { ok: true, kind: 'unknown', path: '' };
    if (detectCache.has(key)) return detectCache.get(key);
    const out = await detectJsonFileType(key);
    detectCache.set(key, out);
    return out;
  }

  if (templateInput) {
    const dt = await detectCached(templateInput);
    if (!dt.ok) return { ok: false, error: `Template import error: ${dt.error}` };
    if (dt.kind === 'timeline' || dt.kind === 'project') {
      if (!timelineInput) {
        timelineInput = templateInput;
        templateInput = '';
      } else {
        return { ok: false, error: 'Template file looks like timeline/project JSON. Choose a event-template JSON file.' };
      }
    }
  }

  if (timelineInput) {
    const dt = await detectCached(timelineInput);
    if (!dt.ok) return { ok: false, error: `Timeline import error: ${dt.error}` };
    if (dt.kind === 'template') {
      if (!templateInput) {
        templateInput = timelineInput;
        timelineInput = '';
      } else {
        return { ok: false, error: 'Timeline file looks like event-template JSON. Choose a timeline JSON file.' };
      }
    }
  }

  if (templateInput) {
    const dt = await detectCached(templateInput);
    if (!dt.ok) return { ok: false, error: `Template import error: ${dt.error}` };
    if (dt.kind !== 'template') {
      return { ok: false, error: 'Template JSON format not recognized.' };
    }
  }

  if (timelineInput) {
    const dt = await detectCached(timelineInput);
    if (!dt.ok) return { ok: false, error: `Timeline import error: ${dt.error}` };
    if (dt.kind !== 'timeline' && dt.kind !== 'project') {
      return { ok: false, error: 'Timeline JSON format not recognized.' };
    }
  }

  if (videoInput) {
    try {
      videoPath = await importAsset(videoInput, projectVideoDir, videoMode, { preferExistingByName: true });
    } catch (error) {
      return { ok: false, error: `Video import error: ${String(error.message || error)}` };
    }
  }

  if (timelineInput) {
    try {
      timelinePath = await importAsset(timelineInput, projectTimelineDir, 'copy', {
        preferExistingByName: true,
        dedupeByExactJson: true,
      });
    } catch (error) {
      return { ok: false, error: `Timeline import error: ${String(error.message || error)}` };
    }
  }

  if (templateInput) {
    try {
      let templateSourcePath = '';
      try {
        templateSourcePath = resolvePathFromRoot(templateInput);
      } catch (_) {
        templateSourcePath = '';
      }
      const libTemplatePath = await importAsset(templateInput, LATCHR_TEMPLATES_DIR, 'copy', {
        preferExistingByName: true,
        dedupeByExactJson: true,
      });
      templatePath = await importAsset(libTemplatePath, projectTemplateDir, 'copy', {
        preferExistingByName: true,
        dedupeByExactJson: true,
      });
      const rewritten = await rewriteTemplateFileWithProjectAssets(templatePath, {
        project_dir: projectDir,
        source_template_path: templateSourcePath || libTemplatePath,
      });
      if (!rewritten.ok) {
        warnings.push(`Template image packaging failed: ${rewritten.error || 'Unknown error'}`);
      } else if (Array.isArray(rewritten.warnings) && rewritten.warnings.length) {
        warnings.push(...rewritten.warnings);
      }
    } catch (error) {
      return { ok: false, error: `Template import error: ${String(error.message || error)}` };
    }
  }

  return {
    ok: true,
    root: LATCHR_ROOT,
    project_name: projectName,
    project_slug: projectSlug,
    project_dir: projectDir,
    project_path: projectPath,
    video_import_mode: videoMode,
    video_path: videoPath,
    timeline_path: timelinePath,
    template_path: templatePath,
    templates_dir: preferredTemplatesDir(),
    templates: listJsonFilesSync(preferredTemplatesDir()),
    warning: warnings.join(' | '),
  };
}

function tailText(text, maxChars = 600) {
  const value = String(text || '').trim();
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    proc.on('error', (error) => {
      resolve({ code: -1, stdout, stderr, error: String(error.message || error) });
    });
    proc.on('close', (code) => {
      resolve({ code: Number(code || 0), stdout, stderr, error: '' });
    });
  });
}

function runCommandBuffer(command, args, options = {}) {
  return new Promise((resolve) => {
    const opts = options && typeof options === 'object' ? options : {};
    const maxStdoutBytesRaw = Number(opts.maxStdoutBytes);
    const maxStdoutBytes = Number.isFinite(maxStdoutBytesRaw) && maxStdoutBytesRaw > 0
      ? Math.trunc(maxStdoutBytesRaw)
      : (12 * 1024 * 1024);
    const proc = spawn(command, args);
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let stderr = '';
    let truncated = false;
    let settled = false;

    function finish(payload) {
      if (settled) return;
      settled = true;
      resolve(payload);
    }

    proc.stdout.on('data', (chunk) => {
      if (truncated) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buf.length;
      if (stdoutBytes > maxStdoutBytes) {
        truncated = true;
        try { proc.kill('SIGKILL'); } catch (_) { }
        return;
      }
      stdoutChunks.push(buf);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', (error) => {
      finish({
        code: -1,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        error: String(error.message || error),
        truncated,
      });
    });
    proc.on('close', (code) => {
      const exitCode = Number.isFinite(code) ? Number(code) : -1;
      finish({
        code: exitCode,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        error: '',
        truncated,
      });
    });
  });
}

function parseClockToSeconds(value) {
  const m = String(value || '').trim().match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return (Number(m[1]) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
}

async function ensureFfprobe(ffmpegPath) {
  const envHintRaw = String(process.env.LATCHR_FFPROBE_PATH || process.env.SPORT_TAGGER_FFPROBE_PATH || '').trim();
  const envHint = envHintRaw ? path.resolve(expandHomePath(envHintRaw)) : '';
  const ffmpegDir = ffmpegPath && ffmpegPath !== 'ffmpeg' ? path.dirname(ffmpegPath) : '';
  const sibling = ffmpegDir ? path.join(ffmpegDir, 'ffprobe') : '';
  const candidates = [
    envHint,
    sibling,
    'ffprobe',
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/opt/local/bin/ffprobe',
    '/usr/bin/ffprobe',
  ].filter(Boolean);
  const seen = new Set();
  for (const candidateRaw of candidates) {
    const candidate = String(candidateRaw || '').trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidate !== 'ffprobe' && !fs.existsSync(candidate)) continue;
    const probe = await runCommand(candidate, ['-version']);
    if (probe.code === 0) {
      return { ok: true, ffprobe: candidate };
    }
  }
  return { ok: false, error: 'ffprobe not found' };
}

async function probeVideoDurationSec(ffprobePath, sourceVideo) {
  if (!ffprobePath || !sourceVideo) return NaN;
  const out = await runCommand(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    sourceVideo,
  ]);
  if (out.code !== 0) return NaN;
  const value = String(out.stdout || '').trim().split(/\s+/).pop() || '';
  const sec = Number(value);
  return Number.isFinite(sec) && sec > 0 ? sec : NaN;
}

function parseFfprobeRate(value) {
  const text = String(value || '').trim();
  if (!text || text === '0/0') return NaN;
  const m = text.match(/^([+-]?\d+(?:\.\d+)?)\/([+-]?\d+(?:\.\d+)?)$/);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return NaN;
    return num / den;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
}

function numberOrNull(value, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (opts.positive && n <= 0) return null;
  if (opts.nonNegative && n < 0) return null;
  return n;
}

async function probeVideoMetadata(ffprobePath, sourceVideo) {
  if (!ffprobePath || !sourceVideo) {
    return { ok: false, error: 'ffprobe path and source video are required' };
  }
  const out = await runCommand(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    sourceVideo,
  ]);
  if (out.code !== 0) {
    return { ok: false, error: tailText(out.stderr || out.stdout || out.error || 'ffprobe failed') };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(out.stdout || '{}'));
  } catch (error) {
    return { ok: false, error: `ffprobe JSON parse error: ${String(error && error.message ? error.message : error)}` };
  }

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const format = parsed.format && typeof parsed.format === 'object' ? parsed.format : {};
  const videoStream = streams.find((s) => String((s && s.codec_type) || '').toLowerCase() === 'video') || {};
  const audioStream = streams.find((s) => String((s && s.codec_type) || '').toLowerCase() === 'audio') || {};

  const widthRaw = numberOrNull(videoStream.width, { positive: true });
  const heightRaw = numberOrNull(videoStream.height, { positive: true });
  const width = widthRaw === null ? null : Math.round(widthRaw);
  const height = heightRaw === null ? null : Math.round(heightRaw);
  const avgRate = parseFfprobeRate(videoStream.avg_frame_rate);
  const realRate = parseFfprobeRate(videoStream.r_frame_rate);
  const fpsRaw = Number.isFinite(avgRate) && avgRate > 0 ? avgRate : realRate;
  const fps = numberOrNull(fpsRaw, { positive: true });
  const durationRaw = numberOrNull(format.duration, { positive: true });
  const durationSec = durationRaw === null ? null : +durationRaw.toFixed(3);
  const sampleRateRaw = numberOrNull(audioStream.sample_rate, { positive: true });
  const sampleRateHz = sampleRateRaw === null ? null : Math.round(sampleRateRaw);
  const bitRateRaw = numberOrNull(format.bit_rate, { positive: true });
  const bitRateBps = bitRateRaw === null ? null : Math.round(bitRateRaw);

  const metadata = {
    schema: schemaId('video_probe.v1'),
    probed_at: new Date().toISOString(),
    video_path: sourceVideo,
    duration_sec: durationSec,
    frame_rate_fps: fps === null ? null : +fps.toFixed(6),
    width,
    height,
    resolution: (width !== null && height !== null) ? `${width}x${height}` : '',
    video_codec: String(videoStream.codec_name || '').trim(),
    audio_sample_rate_hz: sampleRateHz,
    audio_codec: String(audioStream.codec_name || '').trim(),
    format_name: String(format.format_name || '').trim(),
    bit_rate_bps: bitRateBps,
  };
  return { ok: true, metadata };
}

function isLikelyTruncatedDuration(inputSec, outputSec) {
  if (!Number.isFinite(inputSec) || !Number.isFinite(outputSec)) return false;
  if (inputSec <= 60) return false;
  const ratio = outputSec / inputSec;
  const gap = inputSec - outputSec;
  return ratio < 0.95 && gap > 120;
}

function looksLikeCorruptMediaError(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return false;
  return (
    value.includes('partial file') ||
    value.includes('invalid nal unit') ||
    value.includes('error splitting the input into nal units') ||
    value.includes('invalid data found when processing input') ||
    value.includes('moov atom not found') ||
    value.includes('truncated')
  );
}

function formatDurationClock(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return 'n/a';
  const rounded = Math.max(0, Math.round(n));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  const p2 = (v) => String(Math.max(0, Math.trunc(v))).padStart(2, '0');
  if (h > 0) return `${p2(h)}:${p2(m)}:${p2(s)}`;
  return `${p2(m)}:${p2(s)}`;
}

function runFfmpegConvertWithProgress(ffmpegPath, args, totalDurationSec, onProgress) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args);
    let stdout = '';
    let stderr = '';
    let progressBuf = '';
    let lastPercent = -1;
    let lastEmitAt = 0;
    let lastOutSec = 0;

    function emitProgress(outSec, force = false) {
      const outSecSafe = Math.max(0, Number(outSec) || 0);
      if (outSecSafe > lastOutSec) {
        lastOutSec = outSecSafe;
      }
      if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) return;
      const pctRaw = (outSecSafe / totalDurationSec) * 100;
      const percent = Math.max(0, Math.min(100, pctRaw));
      const nowMs = Date.now();
      if (!force && percent <= lastPercent + 0.15 && (nowMs - lastEmitAt) < 180) return;
      lastPercent = percent;
      lastEmitAt = nowMs;
      try {
        onProgress({
          phase: 'progress',
          percent,
          out_sec: outSecSafe,
          duration_sec: totalDurationSec,
        });
      } catch (_) { }
    }

    function processProgressLine(lineRaw) {
      const line = String(lineRaw || '').trim();
      if (!line) return;
      const eq = line.indexOf('=');
      if (eq <= 0) return;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();

      if (key === 'out_time_ms') {
        const outMs = Number(value);
        if (Number.isFinite(outMs) && outMs >= 0) emitProgress(outMs / 1000000);
        return;
      }
      if (key === 'out_time') {
        const outSec = parseClockToSeconds(value);
        if (Number.isFinite(outSec) && outSec >= 0) emitProgress(outSec);
        return;
      }
      if (key === 'progress' && value === 'end') {
        emitProgress(totalDurationSec, true);
      }
    }

    proc.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      progressBuf += text;
      let nl = progressBuf.indexOf('\n');
      while (nl >= 0) {
        const line = progressBuf.slice(0, nl);
        progressBuf = progressBuf.slice(nl + 1);
        processProgressLine(line);
        nl = progressBuf.indexOf('\n');
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', (error) => {
      resolve({
        code: -1,
        stdout,
        stderr,
        error: String(error.message || error),
        out_sec: lastOutSec,
      });
    });
    proc.on('close', (code) => {
      if (progressBuf.trim()) processProgressLine(progressBuf.trim());
      if (Number(code || 0) === 0) emitProgress(totalDurationSec, true);
      resolve({
        code: Number(code || 0),
        stdout,
        stderr,
        error: '',
        out_sec: lastOutSec,
      });
    });
  });
}

async function probeReadableDurationSec(ffmpegPath, sourceVideo) {
  if (!ffmpegPath || !sourceVideo) {
    return {
      ok: false,
      duration_sec: NaN,
      code: -1,
      stdout: '',
      stderr: '',
      error: 'Missing ffmpeg path or source video',
    };
  }
  const run = await runFfmpegConvertWithProgress(ffmpegPath, [
    '-v',
    'error',
    '-i',
    sourceVideo,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-f',
    'null',
    '-',
    '-progress',
    'pipe:1',
    '-nostats',
  ], NaN, null);
  const outSec = Number(run && run.out_sec);
  return {
    ok: Number(run && run.code) === 0,
    duration_sec: Number.isFinite(outSec) && outSec > 0 ? outSec : NaN,
    code: Number(run && run.code),
    stdout: String(run && run.stdout ? run.stdout : ''),
    stderr: String(run && run.stderr ? run.stderr : ''),
    error: String(run && run.error ? run.error : ''),
  };
}

async function ensureFfmpeg() {
  const envHintRaw = String(process.env.LATCHR_FFMPEG_PATH || process.env.SPORT_TAGGER_FFMPEG_PATH || '').trim();
  const envHint = envHintRaw ? path.resolve(expandHomePath(envHintRaw)) : '';
  const appLocal = path.join(ROOT_DIR, 'bin', 'ffmpeg');
  const userLocal = path.join(LATCHR_ROOT, 'bin', 'ffmpeg');
  const legacyUserLocal = path.join(LEGACY_TAGGER_ROOT, 'bin', 'ffmpeg');
  const candidateList = [
    envHint,
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    appLocal,
    userLocal,
    legacyUserLocal,
  ].filter(Boolean);
  const seen = new Set();
  const candidates = [];
  for (const raw of candidateList) {
    const key = String(raw).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(key);
  }

  for (const candidate of candidates) {
    if (candidate !== 'ffmpeg' && !fs.existsSync(candidate)) continue;
    const probe = await runCommand(candidate, ['-version']);
    if (probe.code === 0) {
      return { ok: true, ffmpeg: candidate };
    }
  }

  const installHint = [
    'ffmpeg not found.',
    'Install with: brew install ffmpeg',
    'Or set LATCHR_FFMPEG_PATH (SPORT_TAGGER_FFMPEG_PATH is still accepted).',
    `Checked: ${candidates.join(', ')}`,
  ].join(' ');
  return { ok: false, error: installHint };
}

async function handleLoadJsonPath(payload) {
  const pathText = payload && typeof payload === 'object' ? payload.path : '';
  let resolved;
  try {
    resolved = resolvePathFromRoot(pathText);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }

  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch (_) {
    return { ok: false, error: `JSON file not found: ${resolved}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Not a file: ${resolved}` };
  }
  if (path.extname(resolved).toLowerCase() !== '.json') {
    return { ok: false, error: 'Only .json files are allowed' };
  }

  let data;
  try {
    data = JSON.parse(await fsp.readFile(resolved, 'utf8'));
  } catch (error) {
    return { ok: false, error: `Invalid JSON file: ${String(error.message || error)}` };
  }
  return { ok: true, path: resolved, data };
}

async function handlePickJson(payload) {
  await ensureLatchrWorkspace();
  const title = sanitizeName(payload && payload.title ? payload.title : 'Select JSON file', 'Select JSON file');
  const startDir = String(payload && payload.start_dir ? payload.start_dir : '').trim();
  const out = await dialog.showOpenDialog({
    title,
    defaultPath: startDir || preferredWorkspaceRoot(),
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (out.canceled || !Array.isArray(out.filePaths) || out.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = out.filePaths[0];
  return {
    ok: true,
    path: filePath,
    name: path.basename(filePath),
  };
}

async function handlePickImage(payload) {
  await ensureLatchrWorkspace();
  const title = sanitizeName(payload && payload.title ? payload.title : 'Select Image', 'Select Image');
  const startDir = String(payload && payload.start_dir ? payload.start_dir : '').trim();
  const out = await dialog.showOpenDialog({
    title,
    defaultPath: startDir || preferredWorkspaceRoot(),
    properties: ['openFile'],
    filters: [
      { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'svg'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (out.canceled || !Array.isArray(out.filePaths) || out.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = out.filePaths[0];
  return {
    ok: true,
    path: filePath,
    name: path.basename(filePath),
  };
}

async function resolveProjectFileFromSelection(selectedPath) {
  const raw = String(selectedPath || '').trim();
  if (!raw) return { ok: false, error: 'No project selection provided' };

  let stat;
  try {
    stat = await fsp.stat(raw);
  } catch (error) {
    return { ok: false, error: `Cannot access selected path: ${String(error && error.message ? error.message : error)}` };
  }

  if (stat.isFile()) {
    const fileName = path.basename(raw);
    const lower = fileName.toLowerCase();
    if (!lower.endsWith('.json')) {
      return { ok: false, error: 'Selected file is not a JSON project file' };
    }
    if (/\.bak\.\d+\.json$/i.test(lower)) {
      return { ok: false, error: 'Selected file is a backup JSON. Open the project package or the main .latchr.json / .sporttagger.json file.' };
    }
    return { ok: true, project_path: raw, selected_path: raw, selected_kind: 'file' };
  }

  if (!stat.isDirectory()) {
    return { ok: false, error: 'Selected path is not a file or folder' };
  }

  const dirPath = raw;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isFile() && hasProjectFileExtension(entry.name))
    .map((entry) => path.join(dirPath, entry.name));

  if (candidates.length === 0) {
    return { ok: false, error: `No ${PROJECT_FILE_EXT} or ${LEGACY_PROJECT_FILE_EXT} file found in selected project path` };
  }

  let projectPath = candidates[0];
  if (candidates.length > 1) {
    const dirName = stripProjectPackageExt(path.basename(dirPath).toLowerCase());
    const exact = candidates.find((candidate) => {
      const base = stripProjectFileExt(path.basename(candidate).toLowerCase());
      return base === dirName;
    });
    if (exact) {
      projectPath = exact;
    } else {
      let newestPath = candidates[0];
      let newestMtime = 0;
      for (const candidate of candidates) {
        const st = await fsp.stat(candidate).catch(() => null);
        const mt = st ? Number(st.mtimeMs || 0) : 0;
        if (mt >= newestMtime) {
          newestMtime = mt;
          newestPath = candidate;
        }
      }
      projectPath = newestPath;
    }
  }

  const selectedKind = String(path.basename(dirPath || '')).toLowerCase().endsWith(PROJECT_PACKAGE_EXT)
    ? 'package'
    : 'directory';
  return { ok: true, project_path: projectPath, selected_path: dirPath, selected_kind: selectedKind };
}

async function handleOpenProject() {
  await ensureLatchrWorkspace();
  const out = await dialog.showOpenDialog({
    title: 'Open LatchR Project (.latchr package)',
    defaultPath: preferredProjectsDir(),
    properties: ['openFile', 'openDirectory'],
    filters: [
      { name: 'LatchR Project Package', extensions: [PROJECT_PACKAGE_EXT.replace(/^\./, ''), LEGACY_PROJECT_PACKAGE_EXT.replace(/^\./, '')] },
      { name: 'LatchR Project JSON', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (out.canceled || !Array.isArray(out.filePaths) || out.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }

  const selectedPath = out.filePaths[0];
  const resolved = await resolveProjectFileFromSelection(selectedPath);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error || 'Could not resolve project file from selection' };
  }

  const projectPath = resolved.project_path;
  let raw;
  try {
    raw = await fsp.readFile(projectPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `Cannot read project file: ${String(error.message || error)}` };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `Invalid project JSON: ${String(error.message || error)}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Project file must be a JSON object' };
  }
  return {
    ok: true,
    path: projectPath,
    data,
    selected_path: resolved.selected_path,
    selected_kind: resolved.selected_kind,
  };
}

async function handleSaveProject(payload) {
  await ensureLatchrWorkspace();
  const data = payload && typeof payload === 'object' ? payload.data : null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Project data must be an object' };
  }

  const requestedProjectName = sanitizeProjectFolderName(
    payload && payload.project_name ? payload.project_name : payload && payload.default_name ? payload.default_name : 'LatchR Project',
    'Project',
  );

  let currentPath = '';
  const rawPath = payload && typeof payload.path === 'string' ? payload.path.trim() : '';
  if (rawPath) {
    try {
      currentPath = resolvePathFromRoot(rawPath);
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  }

  let currentProjectDir = '';
  let targetProjectDir = '';
  let targetPath = '';
  if (currentPath) {
    const resolved = resolveProjectDirFromPath(currentPath);
    currentProjectDir = resolved.project_dir;
    targetProjectDir = isProjectPackageDirName(path.basename(currentProjectDir))
      ? preferredProjectDirForSave(currentProjectDir, requestedProjectName)
      : currentProjectDir;
    targetPath = path.join(targetProjectDir, projectFileNameFromName(requestedProjectName));
  } else {
    targetProjectDir = path.join(LATCHR_PROJECTS_DIR, projectPackageDirName(requestedProjectName));
    targetPath = path.join(targetProjectDir, projectFileNameFromName(requestedProjectName));
  }

  const finalData = rewriteProjectLocalSaveData(
    data,
    currentProjectDir || targetProjectDir,
    targetProjectDir || currentProjectDir,
    requestedProjectName,
  );

  if (currentPath) {
    const currentDirExists = await existsPath(currentProjectDir);
    const currentFileExists = await existsFile(currentPath);
    const renameDir = currentProjectDir && targetProjectDir && !sameResolvedPath(currentProjectDir, targetProjectDir);
    const renameFile = !sameResolvedPath(currentPath, targetPath);

    if (renameDir && currentDirExists && !sameFilesystemPath(currentProjectDir, targetProjectDir) && (await existsPath(targetProjectDir))) {
      return { ok: false, error: `Project package already exists: ${path.basename(targetProjectDir)}` };
    }
    if (renameFile && currentFileExists && !sameFilesystemPath(currentPath, targetPath) && (await existsFile(targetPath))) {
      return { ok: false, error: `Project file already exists: ${path.basename(targetPath)}` };
    }

    try {
      if (renameDir && currentDirExists) {
        await fsp.rename(currentProjectDir, targetProjectDir);
      }
      if (renameFile && currentFileExists) {
        const renamedCurrentPath = renameDir
          ? path.join(targetProjectDir, path.basename(currentPath))
          : currentPath;
        if (!sameResolvedPath(renamedCurrentPath, targetPath)) {
          await fsp.rename(renamedCurrentPath, targetPath);
        }
      }
    } catch (error) {
      return { ok: false, error: `Cannot rename project: ${String(error && error.message ? error.message : error)}` };
    }
  }

  try {
    await writeJsonAtomic(targetPath, finalData, { backupExisting: true, backupLimit: 3 });
  } catch (error) {
    return { ok: false, error: `Cannot save project: ${String(error.message || error)}` };
  }

  let warning = '';
  if (String(finalData.video_metadata_path || '').trim()) {
    const manifestSync = await syncProjectVideoMetadataManifest(targetPath, finalData.video_metadata_path);
    if (!manifestSync.ok) warning = manifestSync.error || '';
  }

  return {
    ok: true,
    path: targetPath,
    project_name: finalData.project_name || requestedProjectName,
    project_dir: resolveProjectDirFromPath(targetPath).project_dir,
    video_path: String(finalData.video_path || '').trim(),
    video_metadata_path: String(finalData.video_metadata_path || '').trim(),
    template_path: String(finalData.template_path || '').trim(),
    timeline_path: String(finalData.timeline_path || '').trim(),
    warning,
  };
}

async function handleSaveTagTemplate(payload) {
  await ensureLatchrWorkspace();
  const data = payload && typeof payload === 'object' ? payload.data : null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Template data must be a JSON object' };
  }

  const templateNameRaw = String(payload && payload.template_name ? payload.template_name : '').trim() || 'tag_template';
  const baseName = sanitizeName(templateNameRaw, 'tag_template')
    .replace(/\.json$/i, '')
    .replace(/\.bak\.\d+$/i, '');
  const fileName = `${baseName}.json`;
  const targetPath = path.join(LATCHR_TEMPLATES_DIR, fileName);

  let projectTemplatePath = '';
  let projectDir = '';
  let sourceTemplatePath = '';
  const projectPathRaw = String(payload && payload.project_path ? payload.project_path : '').trim();
  const templatePathRaw = String(payload && payload.template_path ? payload.template_path : '').trim();
  if (templatePathRaw) {
    try {
      sourceTemplatePath = resolvePathFromRoot(templatePathRaw);
    } catch (_) {
      sourceTemplatePath = '';
    }
  }
  if (projectPathRaw) {
    let projectPath = '';
    try {
      projectPath = resolvePathFromRoot(projectPathRaw);
    } catch (_) {
      projectPath = '';
    }
    if (projectPath) {
      projectDir = path.dirname(projectPath);
      const projectTemplateDir = path.join(projectDir, 'tag_templates');
      try {
        await fsp.mkdir(projectTemplateDir, { recursive: true });
        projectTemplatePath = path.join(projectTemplateDir, fileName);
      } catch (_) {
        projectTemplatePath = '';
      }
    }
  }

  let projectTemplateData = data;
  let warning = '';
  let copiedImages = 0;
  if (projectTemplatePath && projectDir) {
    try {
      const packaged = await materializeTemplateImageAssets(data, {
        project_dir: projectDir,
        source_template_path: sourceTemplatePath || targetPath,
      });
      if (!packaged.ok) {
        warning = packaged.error || 'Image packaging failed';
      } else {
        projectTemplateData = packaged.data;
        copiedImages = Array.isArray(packaged.copied) ? packaged.copied.length : 0;
        if (Array.isArray(packaged.warnings) && packaged.warnings.length) {
          warning = packaged.warnings.join(' | ');
        }
      }
    } catch (error) {
      warning = `Image packaging failed: ${String(error && error.message ? error.message : error)}`;
    }
  }

  try {
    await fsp.mkdir(LATCHR_TEMPLATES_DIR, { recursive: true });
    await writeJsonAtomic(targetPath, data, { backupExisting: true, backupLimit: 2 });
    if (projectTemplatePath) {
      await writeJsonAtomic(projectTemplatePath, projectTemplateData, { backupExisting: true, backupLimit: 2 });
    }
  } catch (error) {
    return { ok: false, error: `Cannot save template: ${String(error.message || error)}` };
  }

  return {
    ok: true,
    path: targetPath,
    project_template_path: projectTemplatePath,
    name: fileName,
    templates: listJsonFilesSync(LATCHR_TEMPLATES_DIR),
    warning,
    copied_images: copiedImages,
  };
}

function isInsideDir(parentDir, childPath) {
  const rel = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function handleListProjectTimelines(payload) {
  await ensureLatchrWorkspace();
  const workspace = await resolveProjectTimelineWorkspace(payload && payload.project_path ? payload.project_path : '');
  if (!workspace.ok) return { ok: false, error: workspace.error };
  return {
    ok: true,
    project_path: workspace.project_path,
    timelines_dir: workspace.timelines_dir,
    timelines: listTimelineFilesSync(workspace.timelines_dir),
  };
}

async function handleSaveProjectTimeline(payload) {
  await ensureLatchrWorkspace();
  const data = payload && typeof payload === 'object' ? payload : {};
  const workspace = await resolveProjectTimelineWorkspace(data.project_path || '');
  if (!workspace.ok) return { ok: false, error: workspace.error };

  const events = Array.isArray(data.events) ? data.events : [];
  const periods = Array.isArray(data.periods) ? data.periods : [];
  let targetPath = '';
  const timelinePathRaw = String(data.timeline_path || '').trim();
  const allowOverwrite = !!data.overwrite;

  if (timelinePathRaw) {
    try {
      targetPath = resolvePathFromRoot(timelinePathRaw);
    } catch (error) {
      return { ok: false, error: String(error && error.message ? error.message : error) };
    }
    const targetBase = timelineFileNameFromName(path.basename(targetPath), 'timeline');
    targetPath = path.join(workspace.timelines_dir, targetBase);
  } else {
    const fileName = timelineFileNameFromName(data.timeline_name || 'timeline');
    targetPath = path.join(workspace.timelines_dir, fileName);
  }

  if (!isInsideDir(workspace.timelines_dir, targetPath)) {
    return { ok: false, error: 'Timeline path must be inside project timelines folder' };
  }
  if (!allowOverwrite) {
    targetPath = uniquePathIfExists(targetPath);
  }

  const normalized = normalizeTimelineEvents(events);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  const normalizedPeriods = normalizeTimelinePeriods(periods);
  if (!normalizedPeriods.ok) {
    return { ok: false, error: normalizedPeriods.error };
  }

  let artifacts;
  try {
    await fsp.mkdir(workspace.timelines_dir, { recursive: true });
    artifacts = await writeTimelineArtifacts(targetPath, normalized.events, normalizedPeriods.periods);
  } catch (error) {
    return { ok: false, error: `Cannot save timeline: ${String(error && error.message ? error.message : error)}` };
  }

  return {
    ok: true,
    project_path: workspace.project_path,
    timelines_dir: workspace.timelines_dir,
    path: targetPath,
    name: path.basename(targetPath),
    event_count: normalized.events.length,
    period_count: normalizedPeriods.periods.length,
    event_sha256: artifacts.canonical.event_sha256,
    snapshot_path: artifacts.companions.snapshot,
    manifest_path: artifacts.companions.manifest,
    warning: normalized.warning || '',
    timelines: listTimelineFilesSync(workspace.timelines_dir),
  };
}

async function handleRenameProjectTimeline(payload) {
  await ensureLatchrWorkspace();
  const data = payload && typeof payload === 'object' ? payload : {};
  const workspace = await resolveProjectTimelineWorkspace(data.project_path || '');
  if (!workspace.ok) return { ok: false, error: workspace.error };

  const currentRaw = String(data.timeline_path || '').trim();
  if (!currentRaw) return { ok: false, error: 'timeline_path is required' };

  let currentPath;
  try {
    currentPath = resolvePathFromRoot(currentRaw);
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
  const currentBase = sanitizeName(path.basename(currentPath), path.basename(currentPath));
  currentPath = path.join(workspace.timelines_dir, currentBase);
  if (!isInsideDir(workspace.timelines_dir, currentPath)) {
    return { ok: false, error: 'Timeline path must be inside project timelines folder' };
  }
  if (!(await existsFile(currentPath))) {
    return { ok: false, error: `Timeline not found: ${currentPath}` };
  }

  const nextBase = timelineFileNameFromName(data.new_name || path.basename(currentPath));
  const nextPath = path.join(workspace.timelines_dir, nextBase);
  if (!isInsideDir(workspace.timelines_dir, nextPath)) {
    return { ok: false, error: 'New timeline name is invalid' };
  }
  if (path.resolve(nextPath) !== path.resolve(currentPath) && (await existsFile(nextPath))) {
    return { ok: false, error: `Timeline already exists: ${nextBase}` };
  }

  try {
    if (path.resolve(nextPath) !== path.resolve(currentPath)) {
      await fsp.rename(currentPath, nextPath);
      const oldComp = timelineCompanionPaths(currentPath);
      const newComp = timelineCompanionPaths(nextPath);
      if (await existsFile(oldComp.snapshot)) {
        await fsp.rename(oldComp.snapshot, newComp.snapshot).catch(() => { });
      }
      if (await existsFile(oldComp.manifest)) {
        await fsp.rename(oldComp.manifest, newComp.manifest).catch(() => { });
      }
    }
  } catch (error) {
    return { ok: false, error: `Cannot rename timeline: ${String(error && error.message ? error.message : error)}` };
  }

  return {
    ok: true,
    project_path: workspace.project_path,
    timelines_dir: workspace.timelines_dir,
    old_path: currentPath,
    path: nextPath,
    name: path.basename(nextPath),
    timelines: listTimelineFilesSync(workspace.timelines_dir),
  };
}

async function handleDeleteProjectTimeline(payload) {
  await ensureLatchrWorkspace();
  const data = payload && typeof payload === 'object' ? payload : {};
  const workspace = await resolveProjectTimelineWorkspace(data.project_path || '');
  if (!workspace.ok) return { ok: false, error: workspace.error };

  const currentRaw = String(data.timeline_path || '').trim();
  if (!currentRaw) return { ok: false, error: 'timeline_path is required' };

  let currentPath;
  try {
    currentPath = resolvePathFromRoot(currentRaw);
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
  const currentBase = sanitizeName(path.basename(currentPath), path.basename(currentPath));
  currentPath = path.join(workspace.timelines_dir, currentBase);
  if (!isInsideDir(workspace.timelines_dir, currentPath)) {
    return { ok: false, error: 'Timeline path must be inside project timelines folder' };
  }
  if (!(await existsFile(currentPath))) {
    return { ok: false, error: `Timeline not found: ${currentPath}` };
  }

  const companions = timelineCompanionPaths(currentPath);
  const targets = [
    currentPath,
    companions.snapshot,
    companions.manifest,
    companions.backup1,
    companions.backup2,
    companions.backup3,
    companions.legacy_backup1,
    companions.legacy_backup2,
    companions.legacy_backup3,
  ];

  try {
    for (const target of targets) {
      if (await existsFile(target)) {
        await fsp.unlink(target);
      }
    }
  } catch (error) {
    return { ok: false, error: `Cannot delete timeline: ${String(error && error.message ? error.message : error)}` };
  }

  return {
    ok: true,
    project_path: workspace.project_path,
    timelines_dir: workspace.timelines_dir,
    path: currentPath,
    name: path.basename(currentPath),
    timelines: listTimelineFilesSync(workspace.timelines_dir),
  };
}

function resolveSourceVideo(pathText) {
  const normalized = normalizeSourcePathInput(pathText);
  const resolved = resolvePathFromRoot(normalized);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Video not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${resolved}`);
  }
  return resolved;
}

function normalizeExportClipJobs(clips) {
  const jobs = [];
  const failed = [];
  const seqByTag = new Map();
  const list = Array.isArray(clips) ? clips : [];
  for (let idx = 0; idx < list.length; idx += 1) {
    const clip = list[idx];
    const clipNum = idx + 1;
    if (!clip || typeof clip !== 'object') {
      failed.push({ clip: clipNum, error: 'Clip entry must be object' });
      continue;
    }

    const startSec = Number(clip.start_sec);
    const endSec = Number(clip.end_sec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      failed.push({ clip: clipNum, error: 'Invalid start_sec/end_sec' });
      continue;
    }
    if (endSec <= startSec) {
      failed.push({ clip: clipNum, error: 'end_sec must be > start_sec' });
      continue;
    }

    const tagSlug = sanitizeTagSlug(clip.tag_slug || clip.tag_name || clip.name || 'event', 'event');
    const prevSeq = seqByTag.get(tagSlug) || 0;
    let tagIndex = Number(clip.tag_index);
    if (!Number.isFinite(tagIndex) || tagIndex <= prevSeq || tagIndex < 1) {
      tagIndex = prevSeq + 1;
    }
    tagIndex = Math.trunc(tagIndex);
    seqByTag.set(tagSlug, tagIndex);
    const fileStem = `${tagSlug}_${String(tagIndex).padStart(3, '0')}`;

    jobs.push({
      clipNum,
      startSec,
      endSec,
      durationSec: endSec - startSec,
      tagSlug,
      tagIndex,
      fileStem,
    });
  }
  return { jobs, failed };
}

function buildClipEncodeArgs(sourceVideo, startSec, endSec, outputPath) {
  const duration = (endSec - startSec).toFixed(3);
  return [
    '-y',
    '-ss',
    startSec.toFixed(3),
    '-i',
    sourceVideo,
    '-t',
    duration,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-avoid_negative_ts',
    'make_zero',
    outputPath,
  ];
}

function buildClipEdgeEncodeArgs(sourceVideo, startSec, endSec, outputPath) {
  const durationSec = Math.max(0.001, endSec - startSec);
  return [
    '-y',
    '-ss',
    startSec.toFixed(6),
    '-i',
    sourceVideo,
    '-t',
    durationSec.toFixed(6),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    '-avoid_negative_ts',
    'make_zero',
    outputPath,
  ];
}

function buildClipCopyArgs(sourceVideo, startSec, endSec, outputPath) {
  const durationSec = Math.max(0.001, endSec - startSec);
  return [
    '-y',
    '-ss',
    startSec.toFixed(6),
    '-i',
    sourceVideo,
    '-t',
    durationSec.toFixed(6),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    outputPath,
  ];
}

async function runClipStandardEncode(ffmpegPath, sourceVideo, startSec, endSec, outputPath) {
  const args = buildClipEncodeArgs(sourceVideo, startSec, endSec, outputPath);
  const run = await runCommand(ffmpegPath, args);
  const ok = run.code === 0 && fs.existsSync(outputPath);
  return {
    ok,
    run,
    args,
    error: ok ? '' : tailText(run.stderr || run.stdout || run.error || 'ffmpeg failed'),
  };
}

async function probeVideoKeyframeTimes(ffprobePath, sourceVideo) {
  if (!ffprobePath || !sourceVideo) {
    return { ok: false, error: 'ffprobe path and source video are required', times: [] };
  }
  const out = await runCommand(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-skip_frame',
    'nokey',
    '-show_frames',
    '-show_entries',
    'frame=best_effort_timestamp_time,pkt_pts_time,pkt_dts_time',
    '-of',
    'json',
    sourceVideo,
  ]);
  if (out.code !== 0) {
    return { ok: false, error: tailText(out.stderr || out.stdout || out.error || 'ffprobe keyframe probe failed'), times: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(out.stdout || '{}'));
  } catch (error) {
    return {
      ok: false,
      error: `ffprobe keyframe JSON parse error: ${String(error && error.message ? error.message : error)}`,
      times: [],
    };
  }

  const frames = Array.isArray(parsed.frames) ? parsed.frames : [];
  const times = [];
  for (const frame of frames) {
    const t = numberOrNull(
      frame && (
        frame.best_effort_timestamp_time
        || frame.pkt_pts_time
        || frame.pkt_dts_time
      ),
      { nonNegative: true },
    );
    if (t !== null) times.push(t);
  }
  times.sort((a, b) => a - b);
  const uniq = [];
  for (const t of times) {
    if (!uniq.length || Math.abs(t - uniq[uniq.length - 1]) > 0.0005) {
      uniq.push(t);
    }
  }
  return { ok: true, times: uniq, count: uniq.length };
}

function firstKeyframeAtOrAfter(times, sec) {
  const list = Array.isArray(times) ? times : [];
  const target = Number(sec);
  if (!list.length || !Number.isFinite(target)) return NaN;
  let lo = 0;
  let hi = list.length - 1;
  let ans = NaN;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cur = Number(list[mid]);
    if (cur + 0.000001 >= target) {
      ans = cur;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

function lastKeyframeAtOrBefore(times, sec) {
  const list = Array.isArray(times) ? times : [];
  const target = Number(sec);
  if (!list.length || !Number.isFinite(target)) return NaN;
  let lo = 0;
  let hi = list.length - 1;
  let ans = NaN;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cur = Number(list[mid]);
    if (cur - 0.000001 <= target) {
      ans = cur;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

async function probeKeyframesInWindow(ffprobePath, sourceVideo, fromSec, spanSec) {
  if (!ffprobePath || !sourceVideo) {
    return { ok: false, error: 'ffprobe path and source video are required', times: [] };
  }
  const from = Math.max(0, Number(fromSec) || 0);
  const span = Math.max(0.25, Number(spanSec) || 0.25);
  const out = await runCommand(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-skip_frame',
    'nokey',
    '-show_frames',
    '-show_entries',
    'frame=best_effort_timestamp_time,pkt_pts_time,pkt_dts_time',
    '-of',
    'json',
    '-read_intervals',
    `${from.toFixed(3)}%+${span.toFixed(3)}`,
    sourceVideo,
  ]);
  if (out.code !== 0) {
    return { ok: false, error: tailText(out.stderr || out.stdout || out.error || 'ffprobe keyframe window failed'), times: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(out.stdout || '{}'));
  } catch (error) {
    return {
      ok: false,
      error: `ffprobe keyframe window JSON parse error: ${String(error && error.message ? error.message : error)}`,
      times: [],
    };
  }
  const frames = Array.isArray(parsed.frames) ? parsed.frames : [];
  const times = [];
  for (const frame of frames) {
    const t = numberOrNull(
      frame && (
        frame.best_effort_timestamp_time
        || frame.pkt_pts_time
        || frame.pkt_dts_time
      ),
      { nonNegative: true },
    );
    if (t !== null) times.push(t);
  }
  times.sort((a, b) => a - b);
  const uniq = [];
  for (const t of times) {
    if (!uniq.length || Math.abs(t - uniq[uniq.length - 1]) > 0.0005) {
      uniq.push(t);
    }
  }
  return { ok: true, times: uniq, count: uniq.length };
}

async function smartRenderClip(options = {}) {
  const o = options && typeof options === 'object' ? options : {};
  const ffmpegPath = String(o.ffmpeg_path || '').trim();
  const ffprobePath = String(o.ffprobe_path || '').trim();
  const sourceVideo = String(o.source_video || '').trim();
  const outputPath = String(o.output_path || '').trim();
  const startSec = Number(o.start_sec);
  const endSec = Number(o.end_sec);

  const fallbackEncode = async (reason) => {
    const base = await runClipStandardEncode(ffmpegPath, sourceVideo, startSec, endSec, outputPath);
    if (base.ok) {
      return { ok: true, mode: 'fallback', reason: String(reason || '').trim() || 'fallback encode used' };
    }
    return {
      ok: false,
      mode: 'fallback',
      reason: String(reason || '').trim() || 'fallback encode failed',
      error: base.error,
    };
  };

  if (!ffprobePath) {
    return fallbackEncode('ffprobe unavailable for smart render');
  }
  try {
    const clipStart = Number(startSec);
    const clipEnd = Number(endSec);
    if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd) || clipEnd <= clipStart) {
      return fallbackEncode('invalid clip bounds');
    }

    // Smart mode now uses safe stream-copy only when clip start is very near a keyframe.
    // Otherwise it falls back to the standard re-encode path.
    const windowSpan = 4.0;
    const windowFrom = Math.max(0, clipStart - 2.0);
    const keyProbe = await probeKeyframesInWindow(ffprobePath, sourceVideo, windowFrom, windowSpan);
    if (!keyProbe.ok || !Array.isArray(keyProbe.times) || !keyProbe.times.length) {
      return fallbackEncode(keyProbe.error || 'no keyframe data near clip start');
    }

    const startKeyframe = lastKeyframeAtOrBefore(keyProbe.times, clipStart + 0.0005);
    if (!Number.isFinite(startKeyframe)) {
      return fallbackEncode('clip start keyframe not found');
    }

    const keyframeToleranceSec = 0.08;
    const startGap = clipStart - startKeyframe;
    if (startGap < -0.01 || startGap > keyframeToleranceSec) {
      return fallbackEncode('clip start not near keyframe');
    }

    const copyStart = startKeyframe;
    const copyEnd = clipEnd;
    if ((copyEnd - copyStart) < 0.12) {
      return fallbackEncode('clip too short for smart stream copy');
    }

    const copyArgs = buildClipCopyArgs(sourceVideo, copyStart, copyEnd, outputPath);
    const copyRun = await runCommand(ffmpegPath, copyArgs);
    if (copyRun.code !== 0 || !fs.existsSync(outputPath)) {
      return fallbackEncode('smart stream-copy failed');
    }

    // Protect against broken tiny outputs: if copy duration is too short, retry standard encode.
    const copiedDuration = await probeVideoDurationSec(ffprobePath, outputPath);
    const expectedDuration = copyEnd - copyStart;
    if (!Number.isFinite(copiedDuration)) {
      return fallbackEncode('smart output validation failed');
    }
    if (copiedDuration + 0.05 < (expectedDuration * 0.7)) {
      return fallbackEncode(`smart output too short (${copiedDuration.toFixed(3)}s)`);
    }

    return {
      ok: true,
      mode: 'smart',
      reason: `stream-copy from keyframe (${startGap.toFixed(3)}s lead-in)`,
      copy_start_sec: copyStart,
      copy_end_sec: copyEnd,
    };
  } catch (error) {
    return fallbackEncode(`smart render exception: ${String(error && error.message ? error.message : error)}`);
  }
}

async function prepareSmartRenderContext(ffmpegPath, sourceVideo) {
  const ffprobe = await ensureFfprobe(ffmpegPath);
  if (!ffprobe.ok) {
    return { ok: false, error: ffprobe.error || 'ffprobe unavailable', ffprobe: '', keyframes: [] };
  }

  const meta = await probeVideoMetadata(ffprobe.ffprobe, sourceVideo).catch(() => ({ ok: false, metadata: {} }));
  const vCodec = String(meta && meta.metadata && meta.metadata.video_codec ? meta.metadata.video_codec : '').trim().toLowerCase();
  if (vCodec && vCodec !== 'h264') {
    return {
      ok: false,
      error: `smart render currently supports H.264 source video (found ${vCodec})`,
      ffprobe: ffprobe.ffprobe,
      keyframes: [],
    };
  }

  return {
    ok: true,
    error: '',
    ffprobe: ffprobe.ffprobe,
    video_codec: vCodec,
    audio_codec: String(meta && meta.metadata && meta.metadata.audio_codec ? meta.metadata.audio_codec : '').trim().toLowerCase(),
    keyframes: [],
  };
}

function ffconcatPath(pathText) {
  return String(pathText || '').replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function exportOutputDirForVideo(sourceVideo, videoNameRaw) {
  const videoName = sanitizeName(videoNameRaw || path.basename(sourceVideo), 'video');
  const videoDir = sanitizeName(path.parse(videoName).name, 'video');
  return path.join(EXPORT_ROOT, videoDir);
}

async function handleProbeVideo(payload) {
  await ensureLatchrWorkspace();
  const data = payload && typeof payload === 'object' ? payload : {};
  const sourceVideoPath = String(data.video_path || '').trim();
  if (!sourceVideoPath) {
    return { ok: false, error: 'video_path is required' };
  }

  let sourceVideo;
  try {
    sourceVideo = resolveSourceVideo(sourceVideoPath);
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }

  const ffprobe = await ensureFfprobe('');
  if (!ffprobe.ok) {
    return { ok: false, error: ffprobe.error };
  }

  const probe = await probeVideoMetadata(ffprobe.ffprobe, sourceVideo);
  if (!probe.ok) {
    return { ok: false, error: probe.error };
  }

  let manifestPath = '';
  let warning = '';
  const projectPathRaw = String(data.project_path || '').trim();
  if (projectPathRaw) {
    try {
      manifestPath = await writeVideoMetadataManifest(projectPathRaw, probe.metadata);
    } catch (error) {
      warning = `Could not save ${VIDEO_METADATA_FILE}: ${String(error && error.message ? error.message : error)}`;
    }
  }

  return {
    ok: true,
    ffprobe: ffprobe.ffprobe,
    metadata: probe.metadata,
    manifest_path: manifestPath,
    warning,
  };
}

async function handleExtractFrame(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const sourceVideoPath = String(data.source_video_path || data.video_path || '').trim();
  if (!sourceVideoPath) {
    return { ok: false, error: 'source_video_path is required' };
  }

  const timeRaw = Number(data.time_sec);
  if (!Number.isFinite(timeRaw)) {
    return { ok: false, error: 'time_sec must be a finite number' };
  }
  const timeSec = Math.max(0, timeRaw);

  let sourceVideo;
  try {
    sourceVideo = resolveSourceVideo(sourceVideoPath);
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }

  const ff = await ensureFfmpeg();
  if (!ff.ok) {
    return { ok: false, error: ff.error };
  }

  const maxDim = 4096;
  const reqWidth = numberOrNull(data.width, { positive: true });
  const reqHeight = numberOrNull(data.height, { positive: true });
  const width = reqWidth === null ? null : Math.max(1, Math.min(maxDim, Math.round(reqWidth)));
  const height = reqHeight === null ? null : Math.max(1, Math.min(maxDim, Math.round(reqHeight)));
  const scaleWidth = width === null ? -1 : width;
  const scaleHeight = height === null ? -1 : height;

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    timeSec.toFixed(6),
    '-i',
    sourceVideo,
    '-an',
    '-frames:v',
    '1',
  ];
  if (width !== null || height !== null) {
    args.push('-vf', `scale=${scaleWidth}:${scaleHeight}:force_original_aspect_ratio=decrease`);
  }
  args.push(
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    'pipe:1',
  );

  const run = await runCommandBuffer(ff.ffmpeg, args, { maxStdoutBytes: 12 * 1024 * 1024 });
  if (run.truncated) {
    return { ok: false, error: 'Extracted frame is too large to transfer' };
  }
  const imgBuf = run.stdout;
  if (run.code !== 0 || !imgBuf || !imgBuf.length) {
    return { ok: false, error: tailText(run.stderr || run.error || 'ffmpeg frame extraction failed') };
  }

  return {
    ok: true,
    source_video: sourceVideo,
    time_sec: +timeSec.toFixed(6),
    mime_type: 'image/jpeg',
    image_base64: imgBuf.toString('base64'),
    ffmpeg: ff.ffmpeg,
  };
}

async function handleExportClips(payload) {
  const ff = await ensureFfmpeg();
  if (!ff.ok) {
    return { ok: false, error: ff.error };
  }

  const sourceVideoPath = payload && typeof payload === 'object' ? payload.source_video_path : '';
  let sourceVideo;
  try {
    sourceVideo = resolveSourceVideo(sourceVideoPath);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }

  const clips = payload && Array.isArray(payload.clips) ? payload.clips : null;
  if (!clips || clips.length === 0) {
    return { ok: false, error: 'clips must be a non-empty array' };
  }

  const outDir = exportOutputDirForVideo(sourceVideo, payload && payload.video_name ? payload.video_name : '');
  await fsp.mkdir(outDir, { recursive: true });

  const smartRequested = !!(payload && payload.smart_render);
  const smartWarnings = [];
  let smartUsed = 0;
  let smartFallbacks = 0;
  let smartContext = { ok: false, error: '', keyframes: [] };
  if (smartRequested) {
    try {
      smartContext = await prepareSmartRenderContext(ff.ffmpeg, sourceVideo);
    } catch (error) {
      smartContext = { ok: false, error: String(error && error.message ? error.message : error), keyframes: [] };
    }
    if (!smartContext.ok) {
      smartWarnings.push(`Smart render disabled: ${smartContext.error || 'Unavailable for this source'}`);
    }
  }
  const smartEnabled = smartRequested && !!smartContext.ok;

  const created = [];
  const { jobs, failed } = normalizeExportClipJobs(clips);
  for (const job of jobs) {
    const tagDir = path.join(outDir, job.tagSlug);
    const outFileName = `${job.fileStem}.mp4`;
    job.tagDir = tagDir;
    job.outFilePath = path.join(tagDir, outFileName);
    job.outFileRelative = path.join(job.tagSlug, outFileName);
  }

  for (const job of jobs) {
    await fsp.mkdir(job.tagDir, { recursive: true });

    if (smartEnabled) {
      try {
        const smart = await smartRenderClip({
          ffmpeg_path: ff.ffmpeg,
          ffprobe_path: smartContext.ffprobe || '',
          source_video: sourceVideo,
          start_sec: job.startSec,
          end_sec: job.endSec,
          output_path: job.outFilePath,
          keyframes: smartContext.keyframes,
        });
        if (smart.ok) {
          created.push(job.outFileRelative);
          if (smart.mode === 'smart') smartUsed += 1;
          else {
            smartFallbacks += 1;
            if (smart.reason) smartWarnings.push(`Clip ${job.clipNum}: ${smart.reason}`);
          }
        } else {
          failed.push({
            clip: job.clipNum,
            name: job.fileStem,
            tag: job.tagSlug,
            error: String(smart.error || smart.reason || 'smart render failed'),
          });
        }
      } catch (error) {
        failed.push({
          clip: job.clipNum,
          name: job.fileStem,
          tag: job.tagSlug,
          error: `smart render exception: ${String(error && error.message ? error.message : error)}`,
        });
      }
      continue;
    }

    const run = await runClipStandardEncode(ff.ffmpeg, sourceVideo, job.startSec, job.endSec, job.outFilePath);
    if (run.ok) {
      created.push(job.outFileRelative);
    } else {
      failed.push({
        clip: job.clipNum,
        name: job.fileStem,
        tag: job.tagSlug,
        error: run.error || 'ffmpeg failed',
      });
    }
  }

  if (smartEnabled && failed.length) {
    const byClipNum = new Map();
    jobs.forEach((job) => byClipNum.set(Number(job.clipNum), job));
    const stillFailed = [];
    for (const row of failed) {
      const clipNum = Number(row && row.clip);
      const job = byClipNum.get(clipNum);
      if (!job) {
        stillFailed.push(row);
        continue;
      }
      const retry = await runClipStandardEncode(ff.ffmpeg, sourceVideo, job.startSec, job.endSec, job.outFilePath);
      if (retry.ok) {
        created.push(job.outFileRelative);
        smartFallbacks += 1;
        smartWarnings.push(`Clip ${clipNum}: recovered via standard fallback`);
        continue;
      }
      stillFailed.push({
        ...row,
        error: `${String(row.error || 'smart render failed')} | fallback: ${retry.error || 'ffmpeg failed'}`,
      });
    }
    failed.length = 0;
    stillFailed.forEach((row) => failed.push(row));
  }

  if (smartRequested && created.length === 0 && jobs.length) {
    const forceFailed = [];
    for (const job of jobs) {
      await fsp.mkdir(job.tagDir, { recursive: true });
      const run = await runClipStandardEncode(ff.ffmpeg, sourceVideo, job.startSec, job.endSec, job.outFilePath);
      if (run.ok) {
        created.push(job.outFileRelative);
      } else {
        forceFailed.push({
          clip: job.clipNum,
          name: job.fileStem,
          tag: job.tagSlug,
          error: run.error || 'ffmpeg failed',
        });
      }
    }
    if (created.length) {
      smartWarnings.push('Smart mode yielded zero outputs; recovered using standard export.');
      failed.length = 0;
      forceFailed.forEach((row) => failed.push(row));
      smartFallbacks += created.length;
    }
  }

  await fsp.writeFile(path.join(outDir, 'clips.json'), JSON.stringify(clips, null, 2), 'utf8');

  const shLines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `INPUT="${sourceVideo.replace(/"/g, '\\"')}"`,
    `FFMPEG="${String(ff.ffmpeg || 'ffmpeg').replace(/"/g, '\\"')}"`,
    'OUT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    '',
  ];
  for (const job of jobs) {
    shLines.push(`mkdir -p "$OUT_DIR/${job.tagSlug}"`);
    const shDuration = (job.endSec - job.startSec).toFixed(3);
    shLines.push(
      `"$FFMPEG" -y -ss ${job.startSec.toFixed(3)} -i "$INPUT" -t ${shDuration} -c:v libx264 -preset veryfast -crf 18 -bf 0 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart -avoid_negative_ts make_zero "$OUT_DIR/${job.tagSlug}/${job.fileStem}.mp4"`,
    );
  }
  const shPath = path.join(outDir, 'cut_clips.sh');
  await fsp.writeFile(shPath, `${shLines.join('\n')}\n`, 'utf8');
  await fsp.chmod(shPath, 0o755);

  await fsp.writeFile(
    path.join(outDir, 'README.txt'),
    'Clips generated by LatchR desktop export.\nIf any clip failed, inspect errors in app message and clips.json.\n',
    'utf8',
  );

  if (created.length === 0) {
    const firstErr = failed.length ? String(failed[0].error || '').trim() : '';
    return {
      ok: false,
      error: firstErr || 'No clips exported.',
      mode: 'clips',
      source_video: sourceVideo,
      output_dir: outDir,
      created: 0,
      failed: failed.length,
      errors: failed,
      ffmpeg: ff.ffmpeg,
      smart_render_requested: smartRequested,
      smart_render_enabled: smartEnabled,
      smart_render_used: smartUsed,
      smart_render_fallbacks: smartFallbacks,
      warning: smartWarnings.slice(0, 8).join(' | '),
    };
  }

  return {
    ok: true,
    mode: 'clips',
    source_video: sourceVideo,
    output_dir: outDir,
    created: created.length,
    failed: failed.length,
    files: created,
    errors: failed,
    ffmpeg: ff.ffmpeg,
    smart_render_requested: smartRequested,
    smart_render_enabled: smartEnabled,
    smart_render_used: smartUsed,
    smart_render_fallbacks: smartFallbacks,
    warning: smartWarnings.slice(0, 8).join(' | '),
  };
}

async function handleExportMerged(payload) {
  const ff = await ensureFfmpeg();
  if (!ff.ok) {
    return { ok: false, error: ff.error };
  }

  const sourceVideoPath = payload && typeof payload === 'object' ? payload.source_video_path : '';
  let sourceVideo;
  try {
    sourceVideo = resolveSourceVideo(sourceVideoPath);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }

  const clips = payload && Array.isArray(payload.clips) ? payload.clips : null;
  if (!clips || clips.length === 0) {
    return { ok: false, error: 'clips must be a non-empty array' };
  }

  const outDir = exportOutputDirForVideo(sourceVideo, payload && payload.video_name ? payload.video_name : '');
  await fsp.mkdir(outDir, { recursive: true });

  const normalized = normalizeExportClipJobs(clips);
  const failed = [...normalized.failed];
  const jobs = normalized.jobs;
  if (!jobs.length) {
    return { ok: false, error: 'No valid clips to merge', errors: failed };
  }

  const mergeTmpDir = path.join(outDir, `_merge_tmp_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
  await fsp.mkdir(mergeTmpDir, { recursive: true });
  const partFiles = [];

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const partName = `part_${String(i + 1).padStart(3, '0')}.mp4`;
    const partPath = path.join(mergeTmpDir, partName);
    const args = buildClipEncodeArgs(sourceVideo, job.startSec, job.endSec, partPath);
    const run = await runCommand(ff.ffmpeg, args);
    if (run.code === 0 && fs.existsSync(partPath)) {
      partFiles.push(partPath);
    } else {
      failed.push({
        clip: job.clipNum,
        name: job.fileStem,
        tag: job.tagSlug,
        error: tailText(run.stderr || run.stdout || run.error || 'ffmpeg failed'),
      });
    }
  }

  if (!partFiles.length) {
    return {
      ok: false,
      error: 'Could not render clip segments for merge',
      output_dir: outDir,
      failed: failed.length,
      errors: failed,
      ffmpeg: ff.ffmpeg,
    };
  }
  if (failed.length) {
    return {
      ok: false,
      error: `Could not render all segments for merge (${failed.length} failed)`,
      output_dir: outDir,
      created_parts: partFiles.length,
      failed: failed.length,
      errors: failed,
      ffmpeg: ff.ffmpeg,
    };
  }

  const outputStem = sanitizeName(payload && payload.output_name ? payload.output_name : 'merged', 'merged')
    .replace(/\.mp4$/i, '');
  const mergedPath = uniquePathIfExists(path.join(outDir, `${outputStem}.mp4`));
  const concatListPath = path.join(mergeTmpDir, 'concat_list.txt');
  const concatLines = partFiles.map((partPath) => `file '${ffconcatPath(partPath)}'`);
  await fsp.writeFile(concatListPath, `${concatLines.join('\n')}\n`, 'utf8');

  const mergeArgs = [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    mergedPath,
  ];
  const mergedRun = await runCommand(ff.ffmpeg, mergeArgs);
  if (mergedRun.code !== 0 || !fs.existsSync(mergedPath)) {
    return {
      ok: false,
      error: tailText(mergedRun.stderr || mergedRun.stdout || mergedRun.error || 'ffmpeg merge failed'),
      output_dir: outDir,
      ffmpeg: ff.ffmpeg,
    };
  }

  await fsp.rm(mergeTmpDir, { recursive: true, force: true }).catch(() => { });

  return {
    ok: true,
    mode: 'merged',
    source_video: sourceVideo,
    output_dir: outDir,
    output_file: mergedPath,
    created_parts: partFiles.length,
    failed: 0,
    ffmpeg: ff.ffmpeg,
  };
}

async function handleConvertVideoMp4(payload, onProgress) {
  await ensureLatchrWorkspace();
  const ff = await ensureFfmpeg();
  if (!ff.ok) {
    return { ok: false, error: ff.error };
  }

  const sourceVideoPath = payload && typeof payload === 'object' ? payload.source_video_path : '';
  let sourceVideo;
  try {
    sourceVideo = resolveSourceVideo(sourceVideoPath);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }

  // If user requests conversion of an already-converted file (e.g. *.h264_002.mp4),
  // prefer the sibling original source in the same folder when present.
  let sourceUsed = sourceVideo;
  const parsedSource = path.parse(sourceVideo);
  const convertedMatch = String(parsedSource.name || '').match(/^(.*)\.h264(?:_\d+)?$/i);
  if (convertedMatch) {
    const baseStem = String(convertedMatch[1] || '').trim();
    if (baseStem) {
      const sourceDir = parsedSource.dir;
      const siblingCandidates = await fsp.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
      const ranked = [];
      for (const entry of siblingCandidates) {
        if (!entry.isFile()) continue;
        const abs = path.join(sourceDir, entry.name);
        if (path.resolve(abs) === path.resolve(sourceVideo)) continue;
        const parsed = path.parse(entry.name);
        if (String(parsed.name || '').trim() !== baseStem) continue;
        if (/\.h264(?:_\d+)?$/i.test(String(parsed.name || ''))) continue;
        const stat = await fsp.stat(abs).catch(() => null);
        if (!stat || !stat.isFile()) continue;
        const ext = String(parsed.ext || '').toLowerCase();
        const extRank = ext === '.mp4' ? 3 : ext === '.mov' ? 2 : 1;
        ranked.push({ path: abs, size: Number(stat.size || 0), extRank });
      }
      ranked.sort((a, b) => (b.extRank - a.extRank) || (b.size - a.size));
      if (ranked.length) {
        sourceUsed = ranked[0].path;
      }
    }
    if (path.resolve(sourceUsed) === path.resolve(sourceVideo)) {
      return {
        ok: false,
        error: 'Current video is already a converted .h264 file and original source was not found in the same folder. Select/load the original source video first.',
      };
    }
  }

  const ffprobe = await ensureFfprobe(ff.ffmpeg);
  const totalDurationSec = ffprobe.ok ? await probeVideoDurationSec(ffprobe.ffprobe, sourceUsed) : NaN;
  try {
    onProgress({
      phase: 'source_check',
      percent: NaN,
      duration_sec: totalDurationSec,
      out_sec: 0,
      source_video: sourceUsed,
      source_video_requested: sourceVideo,
    });
  } catch (_) { }
  const sourceReadableProbe = await probeReadableDurationSec(ff.ffmpeg, sourceUsed);
  const sourceReadableDurationSec = Number(sourceReadableProbe.duration_sec);
  const sourceProbeText = [
    sourceReadableProbe.stderr,
    sourceReadableProbe.stdout,
    sourceReadableProbe.error,
  ].filter(Boolean).join('\n');
  const sourceDurationMismatch = isLikelyTruncatedDuration(totalDurationSec, sourceReadableDurationSec);
  const sourceLooksCorrupt = looksLikeCorruptMediaError(sourceProbeText);
  if (sourceDurationMismatch && sourceLooksCorrupt) {
    const readableSecText = Number.isFinite(sourceReadableDurationSec) ? sourceReadableDurationSec.toFixed(1) : 'unknown';
    const sourceSecText = Number.isFinite(totalDurationSec) ? totalDurationSec.toFixed(1) : 'unknown';
    return {
      ok: false,
      error: `Source video appears incomplete/corrupted (readable ${readableSecText}s / ${formatDurationClock(sourceReadableDurationSec)} vs container ${sourceSecText}s / ${formatDurationClock(totalDurationSec)}). Import the original full recording file and retry conversion.`,
      ffmpeg: ff.ffmpeg,
      source_video: sourceUsed,
      source_video_requested: sourceVideo,
      input_duration_sec: totalDurationSec,
      source_readable_duration_sec: sourceReadableDurationSec,
    };
  }
  const expectedDurationSec = Number.isFinite(sourceReadableDurationSec) && sourceReadableDurationSec > 0
    ? sourceReadableDurationSec
    : totalDurationSec;
  try {
    onProgress({
      phase: 'start',
      percent: Number.isFinite(expectedDurationSec) ? 0 : NaN,
      duration_sec: expectedDurationSec,
      out_sec: 0,
      source_video: sourceUsed,
      source_video_requested: sourceVideo,
      source_duration_sec: totalDurationSec,
      source_readable_duration_sec: sourceReadableDurationSec,
    });
  } catch (_) { }

  const parsed = path.parse(sourceUsed);
  const stem = sanitizeName(parsed.name || 'video', 'video').replace(/\.[A-Za-z0-9]+$/g, '');
  const targetBase = `${stem}.h264.mp4`;
  const outputPath = uniquePathIfExists(path.join(LATCHR_VIDEOS_DIR, targetBase));

  function buildConvertArgs(safeMode) {
    const args = ['-y'];
    if (safeMode) {
      args.push('-fflags', '+genpts');
      args.push('-avoid_negative_ts', 'make_zero');
    }
    args.push(
      '-i',
      sourceUsed,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-max_muxing_queue_size',
      '4096',
    );
    if (safeMode) {
      args.push('-af', 'aresample=async=1:first_pts=0');
    }
    args.push(
      '-progress',
      'pipe:1',
      '-nostats',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      outputPath,
    );
    return args;
  }

  async function runConvertAttempt(safeMode) {
    const args = buildConvertArgs(!!safeMode);
    const run = await runFfmpegConvertWithProgress(ff.ffmpeg, args, expectedDurationSec, (evt) => {
      try {
        onProgress({
          ...evt,
          mode: safeMode ? 'safe' : 'normal',
          source_video: sourceUsed,
          source_video_requested: sourceVideo,
          output_path: outputPath,
          source_duration_sec: totalDurationSec,
          source_readable_duration_sec: sourceReadableDurationSec,
        });
      } catch (_) { }
    });
    return run;
  }

  let retriedSafe = false;
  let run = await runConvertAttempt(false);
  if (run.code !== 0 || !fs.existsSync(outputPath)) {
    return {
      ok: false,
      error: tailText(run.stderr || run.stdout || run.error || 'ffmpeg conversion failed'),
      ffmpeg: ff.ffmpeg,
    };
  }

  let outputDurationSec = ffprobe.ok ? await probeVideoDurationSec(ffprobe.ffprobe, outputPath) : NaN;
  if (isLikelyTruncatedDuration(expectedDurationSec, outputDurationSec)) {
    retriedSafe = true;
    try {
      onProgress({
        phase: 'retry',
        percent: 0,
        duration_sec: expectedDurationSec,
        out_sec: outputDurationSec,
        mode: 'safe',
        source_video: sourceUsed,
        source_video_requested: sourceVideo,
        output_path: outputPath,
        source_duration_sec: totalDurationSec,
        source_readable_duration_sec: sourceReadableDurationSec,
      });
    } catch (_) { }
    run = await runConvertAttempt(true);
    if (run.code !== 0 || !fs.existsSync(outputPath)) {
      return {
        ok: false,
        error: tailText(run.stderr || run.stdout || run.error || 'ffmpeg conversion failed in safe mode'),
        ffmpeg: ff.ffmpeg,
      };
    }
    outputDurationSec = ffprobe.ok ? await probeVideoDurationSec(ffprobe.ffprobe, outputPath) : NaN;
    if (isLikelyTruncatedDuration(expectedDurationSec, outputDurationSec)) {
      const outputSecText = Number.isFinite(outputDurationSec) ? outputDurationSec.toFixed(1) : 'unknown';
      const expectedSecText = Number.isFinite(expectedDurationSec) ? expectedDurationSec.toFixed(1) : 'unknown';
      return {
        ok: false,
        error: `Converted output appears truncated (${outputSecText}s vs expected ${expectedSecText}s). Conversion aborted to protect project video.`,
        ffmpeg: ff.ffmpeg,
      };
    }
  }

  try {
    onProgress({
      phase: 'done',
      percent: 100,
      duration_sec: expectedDurationSec,
      out_sec: Number.isFinite(expectedDurationSec) ? expectedDurationSec : NaN,
      source_video: sourceUsed,
      source_video_requested: sourceVideo,
      output_path: outputPath,
      source_duration_sec: totalDurationSec,
      source_readable_duration_sec: sourceReadableDurationSec,
    });
  } catch (_) { }

  return {
    ok: true,
    source_video: sourceUsed,
    source_video_requested: sourceVideo,
    used_alternate_source: path.resolve(sourceUsed) !== path.resolve(sourceVideo),
    retried_safe: retriedSafe,
    input_duration_sec: totalDurationSec,
    source_readable_duration_sec: sourceReadableDurationSec,
    expected_duration_sec: expectedDurationSec,
    output_duration_sec: outputDurationSec,
    output_path: outputPath,
    ffmpeg: ff.ffmpeg,
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

function registerIpcHandler(channelNames, handler) {
  const names = Array.isArray(channelNames) ? channelNames : [channelNames];
  for (const channelName of names) {
    ipcMain.handle(channelName, handler);
  }
}

function sendIpcEvent(channelNames, sender, payload) {
  if (!sender) return;
  const names = Array.isArray(channelNames) ? channelNames : [channelNames];
  for (const channelName of names) {
    try {
      sender.send(channelName, payload || {});
    } catch (_) { }
  }
}

// Keep the old IPC channel names alive so older renderer builds remain compatible.
registerIpcHandler(['latchr:load-json-path', 'sport-tagger:load-json-path'], async (_event, payload) => {
  return handleLoadJsonPath(payload || {});
});

registerIpcHandler(['latchr:list-event-templates', 'sport-tagger:list-event-templates'], async () => {
  return handleListTagTemplates();
});

registerIpcHandler(['latchr:provision-project', 'sport-tagger:provision-project'], async (_event, payload) => {
  return handleProvisionProject(payload || {});
});

registerIpcHandler(['latchr:probe-video', 'sport-tagger:probe-video'], async (_event, payload) => {
  return handleProbeVideo(payload || {});
});
registerIpcHandler(['latchr:extract-frame', 'sport-tagger:extract-frame'], async (_event, payload) => {
  return handleExtractFrame(payload || {});
});

registerIpcHandler(['latchr:export-clips', 'sport-tagger:export-clips'], async (_event, payload) => {
  return handleExportClips(payload || {});
});
registerIpcHandler(['latchr:export-merged', 'sport-tagger:export-merged'], async (_event, payload) => {
  return handleExportMerged(payload || {});
});
registerIpcHandler(['latchr:convert-video-mp4', 'sport-tagger:convert-video-mp4'], async (event, payload) => {
  const sender = event && event.sender ? event.sender : null;
  return handleConvertVideoMp4(payload || {}, (progressPayload) => {
    sendIpcEvent(['latchr:video-convert-progress', 'sport-tagger:video-convert-progress'], sender, progressPayload);
  });
});

registerIpcHandler(['latchr:pick-json', 'sport-tagger:pick-json'], async (_event, payload) => {
  return handlePickJson(payload || {});
});

registerIpcHandler(['latchr:pick-image', 'sport-tagger:pick-image'], async (_event, payload) => {
  return handlePickImage(payload || {});
});

registerIpcHandler(['latchr:open-project', 'sport-tagger:open-project'], async () => {
  return handleOpenProject();
});

registerIpcHandler(['latchr:save-project', 'sport-tagger:save-project'], async (_event, payload) => {
  return handleSaveProject(payload || {});
});

registerIpcHandler(['latchr:save-event-template', 'sport-tagger:save-event-template'], async (_event, payload) => {
  return handleSaveTagTemplate(payload || {});
});

registerIpcHandler(['latchr:list-project-timelines', 'sport-tagger:list-project-timelines'], async (_event, payload) => {
  return handleListProjectTimelines(payload || {});
});

registerIpcHandler(['latchr:save-project-timeline', 'sport-tagger:save-project-timeline'], async (_event, payload) => {
  return handleSaveProjectTimeline(payload || {});
});

registerIpcHandler(['latchr:rename-project-timeline', 'sport-tagger:rename-project-timeline'], async (_event, payload) => {
  return handleRenameProjectTimeline(payload || {});
});

registerIpcHandler(['latchr:delete-project-timeline', 'sport-tagger:delete-project-timeline'], async (_event, payload) => {
  return handleDeleteProjectTimeline(payload || {});
});

registerIpcHandler(['latchr:pick-video', 'sport-tagger:pick-video'], async () => {
  await ensureLatchrWorkspace();
  const out = await dialog.showOpenDialog({
    title: 'Select Source Video',
    defaultPath: preferredWorkspaceRoot(),
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'm4v', 'avi', 'webm', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (out.canceled || !Array.isArray(out.filePaths) || out.filePaths.length === 0) {
    return { ok: false, canceled: true };
  }
  const filePath = out.filePaths[0];
  return {
    ok: true,
    path: filePath,
    name: path.basename(filePath),
  };
});

app.commandLine.appendSwitch('disable-gpu-compositing');

app.whenReady().then(() => {
  ensureLatchrWorkspace().catch(() => { });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
