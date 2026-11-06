import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const uiRoot = dirname(fileURLToPath(import.meta.url));
const cssRoot = join(uiRoot, "css");
const sourceFiles = [
  "account.tsx",
  "admin.ts",
  "landing.tsx",
  "manage.tsx",
  "setup.tsx",
];

function fail(message) {
  throw new Error(`UI asset check failed: ${message}`);
}

function checkCss(fileName) {
  const source = readFileSync(join(cssRoot, fileName), "utf8");
  let depth = 0;
  let quote = "";
  let comment = false;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    const previous = source[index - 1];
    if (comment) {
      if (character === "/" && previous === "*") comment = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth++;
    if (character === "}") {
      if (depth === 0) fail(`${fileName}: unexpected closing brace`);
      depth--;
    }
  }
  if (comment) fail(`${fileName}: unterminated comment`);
  if (quote) fail(`${fileName}: unterminated string`);
  if (depth !== 0) fail(`${fileName}: unbalanced braces`);
}

function cookTemplate(body, fileName) {
  if (body.includes("${")) fail(`${fileName}: browser script contains an unchecked template interpolation`);
  try {
    return vm.runInNewContext(`\`${body}\``);
  } catch (error) {
    fail(`${fileName}: invalid script template (${error.message})`);
  }
}

function checkScripts(fileName) {
  const source = readFileSync(join(uiRoot, fileName), "utf8");
  const returnedScripts = [...source.matchAll(/return\s+`<script>([\s\S]*?)<\/script>`;/g)];
  const inlineScripts = [...source.matchAll(/rawHtml\(`([\s\S]*?)`\)/g)].filter((match) =>
    /(?:window|document)\./.test(match[1]),
  );
  const scripts = [...returnedScripts.map((match) => match[1]), ...inlineScripts.map((match) => match[1].replace(/\$\{[^}]*\}/g, "null"))];
  for (const [index, body] of scripts.entries()) {
    const cooked = cookTemplate(body, `${fileName}#${index + 1}`);
    try {
      new vm.Script(cooked, { filename: `${fileName}#${index + 1}` });
    } catch (error) {
      fail(`${fileName}#${index + 1}: invalid browser script (${error.message})`);
    }
  }
}

for (const fileName of readdirSync(cssRoot).filter((file) => file.endsWith(".css")).sort()) checkCss(fileName);
for (const fileName of sourceFiles) checkScripts(fileName);
console.log("UI assets OK");
