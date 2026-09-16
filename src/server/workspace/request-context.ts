import type { RepositoryContext } from "@/types/workspace";
import { resolveRepositoryContext, type RepositoryContextInput } from "./repository-context";

export async function repositoryContextForRequest(
  request: Request,
  input: RepositoryContextInput = {}
): Promise<RepositoryContext> {
  const params = new URL(request.url).searchParams;
  return resolveRepositoryContext({
    repositoryId:
      params.get("repositoryId") ??
      params.get("contextId") ??
      input.repositoryId ??
      input.contextId,
    repositoryRoot:
      params.get("repositoryRoot") ?? params.get("root") ?? input.repositoryRoot ?? input.root,
  });
}
