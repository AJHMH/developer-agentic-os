import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type SentryHealthState =
  | "healthy"
  | "unconfigured"
  | "authentication"
  | "timeout"
  | "rate_limit"
  | "unavailable"
  | "unhealthy";
export type SentryObservation = {
  state: SentryHealthState;
  project: string | null;
  sourceId: string | null;
  title: string;
  observedAt: string;
  details: Record<string, unknown>;
};

type SentryFetch = (input: string, init?: RequestInit) => Promise<Response>;
type SentryIssue = {
  id?: unknown;
  title?: unknown;
  culprit?: unknown;
  firstSeen?: unknown;
  lastSeen?: unknown;
  count?: unknown;
  level?: unknown;
};

export class SentryAdapter {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly fetcher: SentryFetch = fetch as SentryFetch,
    private readonly repositoryRoot?: string
  ) {}

  async getObservations(): Promise<SentryObservation[]> {
    const config = await this.contextConfig();
    const token = this.env.SENTRY_AUTH_TOKEN || config.token;
    const project = this.env.SENTRY_PROJECT || config.project || null;
    const organization = this.env.SENTRY_ORG || config.organization || null;
    if (!token || !organization || !project)
      return [
        {
          state: "unconfigured",
          project,
          sourceId: null,
          title: "Sentry is not configured.",
          observedAt: new Date().toISOString(),
          details: {
            reason: "missing_configuration",
            missing: [
              !token ? "SENTRY_AUTH_TOKEN" : null,
              !organization ? "SENTRY_ORG" : null,
              !project ? "SENTRY_PROJECT" : null,
            ].filter(Boolean),
          },
        },
      ];
    const baseUrl = (this.env.SENTRY_API_URL || "https://sentry.io/api/0").replace(/\/$/, "");
    try {
      const response = await this.fetcher(
        `${baseUrl}/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/issues/?limit=20`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );
      if (response.status === 401 || response.status === 403)
        return [this.failure("authentication", project, "Sentry credentials were rejected.")];
      if (response.status === 429)
        return [this.failure("rate_limit", project, "Sentry API rate limit has been reached.")];
      if (!response.ok)
        return [this.failure("unavailable", project, `Sentry returned HTTP ${response.status}.`)];
      const issues = (await response.json()) as SentryIssue[];
      if (!issues.length)
        return [
          {
            state: "healthy",
            project,
            sourceId: null,
            title: "Sentry has no open issues.",
            observedAt: new Date().toISOString(),
            details: { issueCount: 0 },
          },
        ];
      return issues.map((issue) => ({
        state: "unhealthy",
        project,
        sourceId: stringValue(issue.id),
        title: stringValue(issue.title) || "Sentry issue",
        observedAt: stringValue(issue.lastSeen) || new Date().toISOString(),
        details: {
          culprit: stringValue(issue.culprit),
          count: issue.count ?? null,
          level: issue.level ?? null,
          firstSeen: issue.firstSeen ?? null,
        },
      }));
    } catch {
      return [
        this.failure("timeout", project, "Sentry request timed out or could not be reached."),
      ];
    }
  }

  private failure(
    state: SentryHealthState,
    project: string | null,
    title: string
  ): SentryObservation {
    return {
      state,
      project,
      sourceId: null,
      title,
      observedAt: new Date().toISOString(),
      details: { readOnly: true },
    };
  }

  private async contextConfig(): Promise<{
    token?: string;
    organization?: string;
    project?: string;
  }> {
    if (!this.repositoryRoot) return {};
    try {
      const content = await readFile(join(this.repositoryRoot, ".sentryclirc"), "utf8");
      const values: Record<string, string> = {};
      let section = "";
      for (const line of content.split(/\r?\n/)) {
        const sectionMatch = /^\s*\[([^\]]+)\]/.exec(line);
        if (sectionMatch) {
          section = sectionMatch[1];
          continue;
        }
        const match = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line);
        if (match) values[`${section}.${match[1]}`] = match[2];
      }
      return {
        token: values["auth.token"],
        organization: values["defaults.org"],
        project: values["defaults.project"],
      };
    } catch {
      return {};
    }
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
