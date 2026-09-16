import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface HostedObjectStore {
  put(
    content: string | Uint8Array,
    contentType: string
  ): Promise<{ reference: string; contentType: string; size: number }>;
  get(reference: string): Promise<Uint8Array>;
}

export class RejectingHostedObjectStore implements HostedObjectStore {
  async put(): Promise<never> {
    throw new Error("Artifact bodies require a durable hosted object store in production.");
  }

  async get(): Promise<never> {
    throw new Error("Artifact bodies require a durable hosted object store in production.");
  }
}

export class LocalHostedObjectStore implements HostedObjectStore {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(process.cwd(), ".developer-agentic-os", "hosted-objects");
  }

  async put(content: string | Uint8Array, contentType: string) {
    const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const reference = createHash("sha256").update(bytes).digest("hex");
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, reference), bytes);
    return { reference, contentType, size: bytes.byteLength };
  }

  async get(reference: string): Promise<Uint8Array> {
    if (
      typeof reference !== "string" ||
      reference.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(reference)
    )
      throw new Error("Invalid object reference.");
    const path = resolve(this.root, reference);
    const relativePath = relative(this.root, path);
    if (
      resolve(this.root, relativePath) !== path ||
      relativePath !== reference ||
      relativePath.includes("\0") ||
      relativePath.includes("/") ||
      relativePath.includes("\\")
    )
      throw new Error("Invalid object reference.");
    return readFile(path);
  }
}
