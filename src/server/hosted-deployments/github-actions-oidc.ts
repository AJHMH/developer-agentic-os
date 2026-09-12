import { createPublicKey, verify } from "node:crypto";

export type GitHubActionsClaims = {
  audience: string;
  repository: string;
  repositoryOwner: string;
  workflow: string;
  ref: string;
};

type JsonWebKeySet = { keys?: Array<Record<string, unknown>> };

export async function verifyGitHubActionsOidcToken(
  token: string,
  expectedAudience: string,
  fetcher: typeof fetch = fetch
): Promise<GitHubActionsClaims> {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature)
    throw new Error("GitHub Actions OIDC token is invalid.");
  const header = decodeJson<{ alg?: string; kid?: string }>(encodedHeader);
  const payload = decodeJson<Record<string, unknown>>(encodedPayload);
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    throw new Error("GitHub Actions OIDC token algorithm is not allowed.");
  if (payload.iss !== "https://token.actions.githubusercontent.com")
    throw new Error("GitHub Actions OIDC issuer is not allowed.");
  if (payload.aud !== expectedAudience)
    throw new Error("GitHub Actions OIDC audience is not allowed.");
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000))
    throw new Error("GitHub Actions OIDC token has expired.");

  const response = await fetcher("https://token.actions.githubusercontent.com/.well-known/jwks");
  if (!response.ok) throw new Error("GitHub Actions OIDC keys could not be loaded.");
  const keySet = (await response.json()) as JsonWebKeySet;
  const jwk = keySet.keys?.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("GitHub Actions OIDC signing key was not found.");
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url")
  );
  if (!valid) throw new Error("GitHub Actions OIDC signature is invalid.");

  const repository = stringClaim(payload.repository, "repository");
  const repositoryOwner = stringClaim(payload.repository_owner, "repository_owner");
  const [repositoryClaimOwner] = repository.split("/");
  if (repositoryClaimOwner.toLowerCase() !== repositoryOwner.toLowerCase())
    throw new Error("GitHub Actions repository claims do not match.");
  const workflowRef = stringClaim(payload.workflow_ref, "workflow_ref");
  const ref = stringClaim(payload.ref, "ref");
  const workflowMarker = "/.github/workflows/";
  const workflowStart = workflowRef.indexOf(workflowMarker);
  if (workflowStart < 0) throw new Error("GitHub Actions workflow claim is invalid.");
  if (!workflowRef.startsWith(`${repository}/`))
    throw new Error("GitHub Actions workflow repository claim does not match.");
  const workflow = workflowRef.slice(workflowStart + workflowMarker.length).split("@")[0];
  return {
    audience: expectedAudience,
    repository,
    repositoryOwner,
    workflow,
    ref,
  };
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error("GitHub Actions OIDC token is invalid.");
  }
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`OIDC ${name} claim is required.`);
  return value;
}
