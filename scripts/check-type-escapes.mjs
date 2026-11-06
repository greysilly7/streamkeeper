import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

const paths = ["streamkeeper.ts", ...files("src")];
const forbidden = /\bas\s+(?:any|unknown)\b|\b(?:any|unknown)\b\s*(?:[|&>,;)}\]])/;
const violations = paths.flatMap((path) => {
  const source = readFileSync(path, "utf8");
  return forbidden.test(source) ? [path] : [];
});

if (violations.length) {
  console.error(`Forbidden TypeScript escape types found in: ${violations.join(", ")}`);
  process.exit(1);
}
