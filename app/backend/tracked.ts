import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const TRACKED_FILE = path.join(DATA_DIR, "tracked.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TRACKED_FILE)) fs.writeFileSync(TRACKED_FILE, "[]");
}

export function getTracked() {
  ensure();
  return JSON.parse(fs.readFileSync(TRACKED_FILE, "utf-8"));
}

export function recordDownload(entry: any) {
  ensure();
  const arr = getTracked();
  arr.push(entry);
  fs.writeFileSync(TRACKED_FILE, JSON.stringify(arr, null, 2));
}
