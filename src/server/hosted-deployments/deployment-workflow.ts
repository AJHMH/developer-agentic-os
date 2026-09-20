export type DeploymentTarget = {
  projectId: string;
  teamId?: string;
};

export type DeploymentWorkflowErrorCode =
  "UNCONFIGURED" | "FORBIDDEN" | "NOT_FOUND" | "UNAVAILABLE" | "INVALID_RESPONSE" | "FAILED";

export class DeploymentWorkflowError extends Error {
  constructor(
    readonly code: DeploymentWorkflowErrorCode,
    message: string,
    readonly status?: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "DeploymentWorkflowError";
  }
}

export type ResolveTargetOptions = {
  endpointUrl: string;
  oidcToken: string;
  fetcher?: typeof fetch;
};

export async function resolveDeploymentWorkflowTarget(
  options: ResolveTargetOptions
): Promise<DeploymentTarget> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(options.endpointUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.oidcToken}`,
        accept: "application/json",
      },
    });
  } catch (error) {
    throw new DeploymentWorkflowError(
      "UNAVAILABLE",
      error instanceof Error
        ? error.message
        : "Failed to connect to deployment resolution endpoint."
    );
  }

  const status = response.status;
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON response
  }

  if (status === 200) {
    const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
    if (!projectId) {
      throw new DeploymentWorkflowError(
        "INVALID_RESPONSE",
        "Resolver response missing required projectId.",
        status,
        data
      );
    }
    const teamId =
      typeof data.teamId === "string" && data.teamId.trim() ? data.teamId.trim() : undefined;
    return { projectId, ...(teamId ? { teamId } : {}) };
  }

  const errorMessage =
    typeof data.error === "string"
      ? data.error
      : `Deployment resolution failed with status ${status}.`;

  if (
    status === 409 &&
    (data.error === "deployment_unconfigured" || /unconfigured/i.test(errorMessage))
  ) {
    throw new DeploymentWorkflowError("UNCONFIGURED", "deployment_unconfigured", status, data);
  }
  if (status === 401 || status === 403) {
    throw new DeploymentWorkflowError("FORBIDDEN", errorMessage, status, data);
  }
  if (status === 404) {
    throw new DeploymentWorkflowError("NOT_FOUND", errorMessage, status, data);
  }
  if (status === 503) {
    throw new DeploymentWorkflowError("UNAVAILABLE", errorMessage, status, data);
  }

  throw new DeploymentWorkflowError("FAILED", errorMessage, status, data);
}

export type ExecuteDeploymentOptions<T = unknown> = {
  endpointUrl: string;
  oidcToken: string;
  fetcher?: typeof fetch;
  deployer: (target: DeploymentTarget) => Promise<T>;
};

export type ExecuteDeploymentResult<T = unknown> =
  | {
      status: "deployed";
      target: DeploymentTarget;
      result: T;
    }
  | {
      status: "unconfigured";
      error: "deployment_unconfigured";
      target: null;
    };

export async function executeDeploymentWorkflow<T = unknown>(
  options: ExecuteDeploymentOptions<T>
): Promise<ExecuteDeploymentResult<T>> {
  let target: DeploymentTarget;
  try {
    target = await resolveDeploymentWorkflowTarget({
      endpointUrl: options.endpointUrl,
      oidcToken: options.oidcToken,
      fetcher: options.fetcher,
    });
  } catch (error) {
    if (error instanceof DeploymentWorkflowError && error.code === "UNCONFIGURED") {
      return {
        status: "unconfigured",
        error: "deployment_unconfigured",
        target: null,
      };
    }
    throw error;
  }

  // Target is verified and resolved; invoke deployer
  const result = await options.deployer(target);
  return {
    status: "deployed",
    target,
    result,
  };
}
