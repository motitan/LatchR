#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const APP_NAME = 'LatchR';
const APP_BUNDLE = `${APP_NAME}.app`;
const APP_BIN_DIR = 'bin';
const APP_LIB_DIR = 'lib';
const APP_ICON_FILE = 'latchr-project.icns';
const LEGACY_DOC_EXTENSION = 'sporttagger';
const PROJECT_DOC_EXTENSION = 'latchr';
const LEGACY_DOC_UTI = 'com.sporttagger.project';
const PROJECT_DOC_UTI = 'com.latchr.project';
const ELECTRON_APP = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const OUTPUT_APP = path.join(DIST_DIR, APP_BUNDLE);
const STAGE_DIR = path.join(DIST_DIR, '.app-stage');
const PACKAGE_DOC_ICON_FILE = APP_ICON_FILE;
const PACKAGE_DOC_ICON_PATH = path.join(ROOT, 'resources', PACKAGE_DOC_ICON_FILE);
const SYSTEM_LIBRARY_PREFIXES = ['/System/Library/', '/usr/lib/'];
const FFMPEG_PATH_CANDIDATES = [
  'ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
];
const FFPROBE_PATH_CANDIDATES = [
  'ffprobe',
  '/opt/homebrew/bin/ffprobe',
  '/usr/local/bin/ffprobe',
  '/opt/local/bin/ffprobe',
  '/usr/bin/ffprobe',
];

function fail(message) {
  console.error(`[package:mac] ${message}`);
  process.exit(1);
}

function setPlistValue(plistPath, key, value, kind = 'string') {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], { stdio: 'ignore' });
    return;
  } catch (_) {
    // Add if the key is missing.
  }
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${kind} ${value}`, plistPath], { stdio: 'ignore' });
}

function runPlistCommand(plistPath, command, allowFailure = false) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', command, plistPath], { stdio: 'ignore' });
    return true;
  } catch (error) {
    if (allowFailure) return false;
    throw error;
  }
}

function configureProjectPackageDocumentType(plistPath) {
  runPlistCommand(plistPath, 'Delete :CFBundleDocumentTypes', true);
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes array');
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes:0 dict');
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes:0:CFBundleTypeName string LatchR Project Package');
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Editor');
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner');
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes:0:LSTypeIsPackage bool true');
  runPlistCommand(plistPath, `Add :CFBundleDocumentTypes:0:CFBundleTypeIconFile string ${PACKAGE_DOC_ICON_FILE}`);
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array');
  runPlistCommand(plistPath, `Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string ${PROJECT_DOC_EXTENSION}`);
  runPlistCommand(plistPath, `Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:1 string ${LEGACY_DOC_EXTENSION}`);
  runPlistCommand(plistPath, 'Add :CFBundleDocumentTypes:0:LSItemContentTypes array');
  runPlistCommand(plistPath, `Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string ${PROJECT_DOC_UTI}`);
  runPlistCommand(plistPath, `Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string ${LEGACY_DOC_UTI}`);

  runPlistCommand(plistPath, 'Delete :UTExportedTypeDeclarations', true);
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations array');
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0 dict');
  runPlistCommand(plistPath, `Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string ${PROJECT_DOC_UTI}`);
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0:UTTypeDescription string LatchR Project Package');
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array');
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string com.apple.package');
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:1 string public.directory');
  runPlistCommand(plistPath, `Add :UTExportedTypeDeclarations:0:UTTypeIconFile string ${PACKAGE_DOC_ICON_FILE}`);
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict');
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array');
  runPlistCommand(plistPath, `Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string ${PROJECT_DOC_EXTENSION}`);
  runPlistCommand(plistPath, 'Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.mime-type string application/x-latchr');

  runPlistCommand(plistPath, 'Delete :UTImportedTypeDeclarations', true);
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations array');
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0 dict');
  runPlistCommand(plistPath, `Add :UTImportedTypeDeclarations:0:UTTypeIdentifier string ${LEGACY_DOC_UTI}`);
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0:UTTypeDescription string Legacy LatchR Project Package');
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0:UTTypeConformsTo array');
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0:UTTypeConformsTo:0 string com.apple.package');
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0:UTTypeConformsTo:1 string public.directory');
  runPlistCommand(plistPath, `Add :UTImportedTypeDeclarations:0:UTTypeIconFile string ${PACKAGE_DOC_ICON_FILE}`);
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification dict');
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array');
  runPlistCommand(plistPath, `Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string ${LEGACY_DOC_EXTENSION}`);
  runPlistCommand(plistPath, 'Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.mime-type string application/x-sporttagger');
}

function dittoCopy(srcPath, dstPath) {
  execFileSync('/usr/bin/ditto', [srcPath, dstPath], { stdio: 'ignore' });
}

function copyIfExists(srcPath, dstPath) {
  if (!fs.existsSync(srcPath)) return;
  fs.cpSync(srcPath, dstPath, { recursive: true, verbatimSymlinks: true });
}

function isDylibPath(filePath) {
  return path.extname(filePath) === '.dylib';
}

function isSystemLibrary(filePath) {
  return SYSTEM_LIBRARY_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function parseLinkedLibraries(filePath) {
  const output = execFileSync('/usr/bin/otool', ['-L', filePath], { encoding: 'utf8' });
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?) \(compatibility version /);
      return match ? match[1] : '';
    })
    .filter(Boolean);
}

function verifyToolBinary(candidatePath) {
  try {
    execFileSync(candidatePath, ['-version'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function resolveToolCandidate(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return '';

  try {
    if (raw.includes(path.sep)) {
      const abs = path.resolve(raw);
      if (!fs.existsSync(abs) || !verifyToolBinary(abs)) return '';
      return fs.realpathSync(abs);
    }

    if (!verifyToolBinary(raw)) return '';
    const located = execFileSync('/usr/bin/which', [raw], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return located ? fs.realpathSync(located) : '';
  } catch (_) {
    return '';
  }
}

function dedupePaths(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function locateToolBinary(toolName, candidates) {
  const resolved = dedupePaths(candidates).map(resolveToolCandidate).find(Boolean);
  if (resolved) return resolved;
  fail(`${toolName} not found. Install with \`brew install ffmpeg\` before packaging.`);
}

function resolveLibraryDependency(sourcePath, dependencyPath) {
  if (!dependencyPath.startsWith('/')) {
    fail(`Unsupported non-absolute dependency "${dependencyPath}" while bundling ${sourcePath}.`);
  }
  try {
    return fs.realpathSync(dependencyPath);
  } catch (error) {
    fail(`Unable to resolve dependency "${dependencyPath}" required by ${sourcePath}: ${String(error && error.message ? error.message : error)}`);
  }
}

function collectBundledLibraries(entryPaths) {
  const queue = entryPaths.map((entryPath) => fs.realpathSync(entryPath));
  const bySourcePath = new Map();
  const byBasename = new Map();

  while (queue.length > 0) {
    const sourcePath = queue.pop();
    const linkedLibraries = parseLinkedLibraries(sourcePath);
    const dependencies = isDylibPath(sourcePath) ? linkedLibraries.slice(1) : linkedLibraries;

    dependencies.forEach((dependencyPath) => {
      if (isSystemLibrary(dependencyPath)) return;

      const resolvedDependencyPath = resolveLibraryDependency(sourcePath, dependencyPath);
      const fileName = path.basename(resolvedDependencyPath);
      const existingPath = byBasename.get(fileName);
      if (existingPath && existingPath !== resolvedDependencyPath) {
        fail(`Library basename collision while bundling ffmpeg: ${fileName}`);
      }

      byBasename.set(fileName, resolvedDependencyPath);
      if (bySourcePath.has(resolvedDependencyPath)) return;
      bySourcePath.set(resolvedDependencyPath, {
        fileName,
        sourcePath: resolvedDependencyPath,
      });
      queue.push(resolvedDependencyPath);
    });
  }

  return Array.from(bySourcePath.values()).sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function rewriteLinkedLibraries(targetPath, sourcePath, mode) {
  const linkedLibraries = parseLinkedLibraries(sourcePath);
  const dependencies = mode === 'library' ? linkedLibraries.slice(1) : linkedLibraries;

  dependencies.forEach((dependencyPath) => {
    if (isSystemLibrary(dependencyPath)) return;

    const resolvedDependencyPath = resolveLibraryDependency(sourcePath, dependencyPath);
    const fileName = path.basename(resolvedDependencyPath);
    const bundledPath = mode === 'library'
      ? `@loader_path/${fileName}`
      : `@executable_path/../${APP_LIB_DIR}/${fileName}`;
    execFileSync('/usr/bin/install_name_tool', ['-change', dependencyPath, bundledPath, targetPath], { stdio: 'ignore' });
  });

  if (mode === 'library') {
    execFileSync('/usr/bin/install_name_tool', ['-id', `@loader_path/${path.basename(targetPath)}`, targetPath], { stdio: 'ignore' });
  }
}

function bundleFfmpegRuntime(stageRoot) {
  const ffmpegCandidatePaths = dedupePaths([
    process.env.LATCHR_FFMPEG_PATH,
    process.env.SPORT_TAGGER_FFMPEG_PATH,
    ...FFMPEG_PATH_CANDIDATES,
  ]);
  const ffmpegPath = locateToolBinary('ffmpeg', ffmpegCandidatePaths);
  const siblingFfprobePath = path.join(path.dirname(ffmpegPath), 'ffprobe');
  const ffprobeCandidatePaths = dedupePaths([
    process.env.LATCHR_FFPROBE_PATH,
    process.env.SPORT_TAGGER_FFPROBE_PATH,
    siblingFfprobePath,
    ...FFPROBE_PATH_CANDIDATES,
  ]);
  const ffprobePath = locateToolBinary('ffprobe', ffprobeCandidatePaths);

  const binDir = path.join(stageRoot, APP_BIN_DIR);
  const libDir = path.join(stageRoot, APP_LIB_DIR);
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  const bundledExecutables = [
    { sourcePath: ffmpegPath, targetPath: path.join(binDir, 'ffmpeg') },
    { sourcePath: ffprobePath, targetPath: path.join(binDir, 'ffprobe') },
  ];
  const bundledLibraries = collectBundledLibraries([ffmpegPath, ffprobePath]);

  bundledExecutables.forEach(({ sourcePath, targetPath }) => {
    fs.copyFileSync(sourcePath, targetPath);
    fs.chmodSync(targetPath, 0o755);
  });

  bundledLibraries.forEach((library) => {
    const targetPath = path.join(libDir, library.fileName);
    fs.copyFileSync(library.sourcePath, targetPath);
    fs.chmodSync(targetPath, 0o755);
    library.targetPath = targetPath;
  });

  bundledExecutables.forEach(({ sourcePath, targetPath }) => {
    rewriteLinkedLibraries(targetPath, sourcePath, 'executable');
  });
  bundledLibraries.forEach(({ sourcePath, targetPath }) => {
    rewriteLinkedLibraries(targetPath, sourcePath, 'library');
  });
}

function buildRuntimeStage(pkg) {
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  const runtimeFiles = ['main.js', 'preload.js', 'index.html'];
  runtimeFiles.forEach((fileName) => {
    const src = path.join(ROOT, fileName);
    if (!fs.existsSync(src)) fail(`Missing runtime file: ${fileName}`);
    fs.copyFileSync(src, path.join(STAGE_DIR, fileName));
  });

  // Optional runtime assets.
  copyIfExists(path.join(ROOT, 'styles.css'), path.join(STAGE_DIR, 'styles.css'));
  copyIfExists(path.join(ROOT, 'assets'), path.join(STAGE_DIR, 'assets'));
  bundleFfmpegRuntime(STAGE_DIR);

  const runtimePackage = {
    name: pkg.name || 'latchr',
    productName: APP_NAME,
    version: pkg.version || '0.0.0',
    private: true,
    main: 'main.js',
    description: pkg.description || 'LatchR desktop app',
  };
  fs.writeFileSync(path.join(STAGE_DIR, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
}

function packageApp() {
  if (process.platform !== 'darwin') {
    fail('This script only works on macOS.');
  }
  if (!fs.existsSync(ELECTRON_APP)) {
    fail('Electron runtime not found. Run `npm install` first.');
  }

  const packageJsonPath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(packageJsonPath)) fail('package.json not found.');
  if (!fs.existsSync(PACKAGE_DOC_ICON_PATH)) {
    fail(`Project package icon not found at ${PACKAGE_DOC_ICON_PATH}.`);
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  buildRuntimeStage(pkg);

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.rmSync(OUTPUT_APP, { recursive: true, force: true });
  // Keep Electron's internal relative symlink layout intact.
  dittoCopy(ELECTRON_APP, OUTPUT_APP);

  const appResources = path.join(OUTPUT_APP, 'Contents', 'Resources', 'app');
  const bundleResources = path.join(OUTPUT_APP, 'Contents', 'Resources');
  fs.rmSync(appResources, { recursive: true, force: true });
  dittoCopy(STAGE_DIR, appResources);
  fs.copyFileSync(PACKAGE_DOC_ICON_PATH, path.join(bundleResources, PACKAGE_DOC_ICON_FILE));
  fs.copyFileSync(PACKAGE_DOC_ICON_PATH, path.join(bundleResources, 'electron.icns'));

  const plistPath = path.join(OUTPUT_APP, 'Contents', 'Info.plist');
  const executablePath = path.join(OUTPUT_APP, 'Contents', 'MacOS', 'Electron');
  const renamedExecutablePath = path.join(OUTPUT_APP, 'Contents', 'MacOS', APP_NAME);
  if (fs.existsSync(executablePath)) {
    fs.renameSync(executablePath, renamedExecutablePath);
  }

  setPlistValue(plistPath, 'CFBundleDisplayName', APP_NAME);
  setPlistValue(plistPath, 'CFBundleName', APP_NAME);
  setPlistValue(plistPath, 'CFBundleExecutable', APP_NAME);
  setPlistValue(plistPath, 'CFBundleIdentifier', 'com.latchr.app');
  setPlistValue(plistPath, 'CFBundleIconFile', APP_ICON_FILE);
  setPlistValue(plistPath, 'CFBundleShortVersionString', pkg.version || '0.0.0');
  setPlistValue(plistPath, 'CFBundleVersion', pkg.version || '0.0.0');
  configureProjectPackageDocumentType(plistPath);

  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  console.log(`[package:mac] Built ${OUTPUT_APP}`);
}

packageApp();
