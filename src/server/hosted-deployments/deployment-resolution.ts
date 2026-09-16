export type RegisteredDeploymentRepository = {
  tenantId: string;
  owner: string;
  repository: string;
  workflow: string;
  ref: string;
};

export type DeploymentProjectMapping = {
  projectId: string;
  teamId?: string;
};

export type DeploymentResolutionRequest = RegisteredDeploymentRepository & {
  audience: string;
};

export interface DeploymentRegistry {
  findRepository(
    tenantId: string,
    owner: string,
    repository: string
  ): Promise<RegisteredDeploymentRepository | null>;
  findProject(tenantId: string): Promise<DeploymentProjectMapping | null>;
}

export class DeploymentResolutionError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "NOT_FOUND" | "UNCONFIGURED",
    message: string
  ) {
    super(message);
    this.name = "DeploymentResolutionError";
  }
}

const deploymentAudience = "developer-agentic-os";

export async function resolveDeploymentTarget(
  registry: DeploymentRegistry,
  request: DeploymentResolutionRequest,
  expectedAudience = deploymentAudience
): Promise<DeploymentProjectMapping> {
  if (request.audience !== expectedAudience)
    throw new DeploymentResolutionError("FORBIDDEN", "Deployment audience is not allowed.");

  const registered = await registry.findRepository(
    request.tenantId,
    request.owner,
    request.repository
  );
  if (!registered)
    throw new DeploymentResolutionError("NOT_FOUND", "Repository registration was not found.");

  if (
    registered.tenantId !== request.tenantId ||
    registered.owner.toLowerCase() !== request.owner.toLowerCase() ||
    registered.repository.toLowerCase() !== request.repository.toLowerCase() ||
    registered.workflow !== request.workflow ||
    registered.ref !== request.ref
  )
    throw new DeploymentResolutionError("FORBIDDEN", "Deployment identity is not allowed.");

  const project = await registry.findProject(request.tenantId);
  if (!project) throw new DeploymentResolutionError("UNCONFIGURED", "deployment_unconfigured");
  return project;
}
