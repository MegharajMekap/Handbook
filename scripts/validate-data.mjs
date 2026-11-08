#!/usr/bin/env node
// Validates the class schedule stored in Firebase ("classes", public read):
//   - required fields present and well-formed (date, subject, lecture, term)
//   - no recording link or passcode leaked into the public node
//   - thumb, when set, points at a file that actually exists in thumbnails/
//
// Recording links live in the admin-only "recordingUrls" node, so they are not checked here.
//
// Usage: node scripts/validate-data.mjs

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLASSES_URL = "https://iim-emba-handbook-default-rtdb.firebaseio.com/classes.json";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function fetchClasses() {
  const res = await fetch(CLASSES_URL);
  if (!res.ok) throw new Error(`Could not read classes from Firebase (HTTP ${res.status})`);
  const data = await res.json();
  return data ? Object.entries(data).map(([key, v]) => ({ key, ...v })) : [];
}

function validate(classes) {
  const errors = [];
  classes.forEach((r) => {
    const where = `${r.key} (${r.subject ?? "?"} / ${r.lecture ?? "?"})`;
    if (!r.date || !DATE_RE.test(r.date)) errors.push(`${where}: missing/invalid date "${r.date}"`);
    if (!r.subject) errors.push(`${where}: missing subject`);
    if (!r.lecture) errors.push(`${where}: missing lecture`);
    if (!r.term) errors.push(`${where}: missing term`);
    if (r.url || r.passcode) errors.push(`${where}: link/passcode must not be stored in the public "classes" node`);
    if (r.thumb && !existsSync(path.join(ROOT, r.thumb))) {
      errors.push(`${where}: thumb "${r.thumb}" does not exist on disk`);
    }
  });
  return errors;
}

async function main() {
  const classes = await fetchClasses();
  console.log(`Found ${classes.length} classes.`);
  if (!classes.length) {
    console.error("\nNo classes found in Firebase.");
    process.exit(1);
  }

  const errors = validate(classes);
  if (errors.length) {
    console.error("\nErrors:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\n${errors.length} error(s) found.`);
    process.exit(1);
  }

  console.log("\nAll classes look good.");
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
