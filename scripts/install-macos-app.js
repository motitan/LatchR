#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'LatchR.app';
const SOURCE_APP = path.join(ROOT, 'dist', APP_NAME);
const TARGET_APP = path.join('/Applications', APP_NAME);

function fail(message) {
  console.error(`[install:mac] ${message}`);
  process.exit(1);
}

function install() {
  if (process.platform !== 'darwin') {
    fail('This script only works on macOS.');
  }
  if (!fs.existsSync(SOURCE_APP)) {
    fail(`App bundle not found at ${SOURCE_APP}. Run \`npm run package:mac\` first.`);
  }

  try {
    fs.rmSync(TARGET_APP, { recursive: true, force: true });
    fs.cpSync(SOURCE_APP, TARGET_APP, { recursive: true });
  } catch (error) {
    fail(`Install failed: ${String(error && error.message ? error.message : error)}`);
  }

  console.log(`[install:mac] Installed to ${TARGET_APP}`);
}

install();
