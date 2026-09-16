import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

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
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
