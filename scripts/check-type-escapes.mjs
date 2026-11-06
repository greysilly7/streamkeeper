import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function files(root, extensions) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path, extensions) : extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

const paths = ["streamkeeper.ts", ...files("src", [".ts", ".tsx"])];
const forbidden = /\bas\s+(?:any|unknown)\b|:\s*(?:any|unknown)\b|\b(?:any|unknown)\b\s*(?:[|&>,;)}\]])/;
const inlineForbidden = /\bas\s+(?:any|unknown)\b/;
const violations = [];

for (const path of paths) {
  const source = readFileSync(path, "utf8");
  if (forbidden.test(source)) violations.push(path);

  for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (inlineForbidden.test(match[1])) violations.push(`${path} (inline script)`);
  }
}

if (violations.length) {
  console.error(`Forbidden TypeScript escape types found in: ${violations.join(", ")}`);
  process.exit(1);
}
