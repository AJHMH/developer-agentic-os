# src/server/local-store/json-file.ts

- JsonFileValue · type · L5-L6 — type JsonFileValue = string | number | boolean | null | JsonFileValue[] | { [key: string]: JsonFileValue };
- readJsonFile · function · L8-L17 — async function readJsonFile<T>(path: string, fallback: T): Promise<T>
- writeJsonFile · function · L19-L41 — async function writeJsonFile(path: string, value: unknown): Promise<void>
- serializeJsonFile · function · L43-L45 — function serializeJsonFile(value: unknown): string
- toJsonFileValue · function · L47-L80 — function toJsonFileValue(value: unknown, seen = new Set<object>()): JsonFileValue
- isPlainObject · function · L82-L85 — function isPlainObject(value: object): value is Record<string, unknown>
