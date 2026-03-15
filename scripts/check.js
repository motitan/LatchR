#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function fail(msg) {
  console.error(`check failed: ${msg}`);
  process.exit(1);
}

function mustExist(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) fail(`missing required file: ${rel}`);
  return p;
}

function parseJS(rel) {
  const p = mustExist(rel);
  const src = fs.readFileSync(p, 'utf8');
  try {
    new Function(src);
  } catch (err) {
    fail(`syntax error in ${rel}: ${err.message}`);
  }
}

function parseInlineScriptFromHTML(rel) {
  const p = mustExist(rel);
  const html = fs.readFileSync(p, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/i);
  if (!m) fail(`${rel} has no inline <script> block`);
  try {
    new Function(m[1]);
  } catch (err) {
    fail(`syntax error in inline script of ${rel}: ${err.message}`);
  }
}

function parseJSON(rel) {
  const p = mustExist(rel);
  try {
    JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    fail(`invalid JSON in ${rel}: ${err.message}`);
  }
}

function main() {
  parseJSON('package.json');
  parseJS('main.js');
  parseJS('preload.js');
  parseInlineScriptFromHTML('index.html');

  // Optional baseline data file check (if present)
  const timelinePath = path.join(root, 'timeline.json');
  if (fs.existsSync(timelinePath)) {
    parseJSON('timeline.json');
  }

  console.log('check ok');
}

main();
