import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("env.json");
const destination = resolve("dist/env.json");

if (!existsSync(source)) {
  throw new Error(`Missing ${source}. Copy env.example.json to env.json first.`);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
