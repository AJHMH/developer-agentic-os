const locks = new Map<string, Promise<void>>();

export async function withStateLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(root, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(root) === current) locks.delete(root);
  }
}
