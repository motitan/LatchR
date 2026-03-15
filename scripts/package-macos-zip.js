#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT, 'release');
const APP_NAME = 'LatchR';
const APP_BUNDLE = `${APP_NAME}.app`;
const APP_PATH = path.join(DIST_DIR, APP_BUNDLE);
const PROJECT_OPENER_NAME = 'Open LatchR Project.command';
const PROJECT_OPENER_PATH = path.join(ROOT, PROJECT_OPENER_NAME);
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const ZIP_STAGE_DIR = path.join(RELEASE_DIR, '.zip-stage');

function fail(message) {
  console.error(`[package:mac:zip] ${message}`);
  process.exit(1);
}

function packageZip() {
  if (process.platform !== 'darwin') {
    fail('This script only works on macOS.');
  }
  if (!fs.existsSync(PACKAGE_JSON_PATH)) {
    fail('package.json not found.');
  }
  if (!fs.existsSync(APP_PATH)) {
    fail(`App bundle not found at ${APP_PATH}. Run \`npm run package:mac\` first.`);
  }

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const version = String(pkg.version || '0.0.0').trim() || '0.0.0';
  const releaseFolderName = `${APP_NAME}-macOS-v${version}`;
  const zipName = `${releaseFolderName}.zip`;
  const zipPath = path.join(RELEASE_DIR, zipName);
  const stageRoot = path.join(ZIP_STAGE_DIR, releaseFolderName);
  const stagedAppPath = path.join(stageRoot, APP_BUNDLE);

  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(ZIP_STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.cpSync(APP_PATH, stagedAppPath, { recursive: true, verbatimSymlinks: true });
  if (fs.existsSync(PROJECT_OPENER_PATH)) {
    const stagedOpenerPath = path.join(stageRoot, PROJECT_OPENER_NAME);
    fs.copyFileSync(PROJECT_OPENER_PATH, stagedOpenerPath);
    fs.chmodSync(stagedOpenerPath, 0o755);
  }

  execFileSync(
    '/usr/bin/ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', stageRoot, zipPath],
    { stdio: 'ignore' }
  );

  fs.rmSync(ZIP_STAGE_DIR, { recursive: true, force: true });

  console.log(`[package:mac:zip] Built ${zipPath}`);
}

packageZip();
