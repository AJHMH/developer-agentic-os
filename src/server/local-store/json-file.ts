import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export type JsonFileValue =
  string | number | boolean | null | JsonFileValue[] | { [key: string]: JsonFileValue };

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const resolvedPath = resolve(path);
    return JSON.parse(await readFile(resolvedPath, "utf8")) as T;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return fallback;
    throw error;
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const resolvedPath = resolve(path);
  const dir = dirname(resolvedPath);
  await mkdir(dir, { recursive: true });
  const fileName = basename(resolvedPath);
  const temporaryPath = resolve(dir, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
  const contents = serializeJsonFile(value);
  // lgtm [js/http-to-file-access] Callers persist local store state, and values are validated as JSON before writing.
  await writeFile(temporaryPath, contents, "utf8");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rename(temporaryPath, resolvedPath);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if ((code !== "EPERM" && code !== "EBUSY") || attempt === 3) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
      await new Promise((res) => setTimeout(res, 10 * (attempt + 1)));
    }
  }
}

function serializeJsonFile(value: unknown): string {
  return `${JSON.stringify(toJsonFileValue(value), null, 2)}\n`;
}

function toJsonFileValue(value: unknown, seen = new Set<object>()): JsonFileValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("JSON files cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => toJsonFileValue(item, seen));
  if (typeof value !== "object" || !isPlainObject(value)) {
    throw new TypeError("Local store values must be JSON-serializable data.");
  }
  if (seen.has(value)) throw new TypeError("Local store values cannot contain circular data.");
  seen.add(value);
  const jsonObject: { [key: string]: JsonFileValue } = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) jsonObject[key] = toJsonFileValue(item, seen);
  }
  seen.delete(value);
  return jsonObject;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
