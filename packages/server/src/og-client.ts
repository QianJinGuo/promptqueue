/**
 * OpenGorilla HTTP client — wraps OG's 5 REST endpoints.
 * All methods return null on failure for graceful degradation.
 */

export interface OGContextResponse {
  experiences: Array<{
    id: string;
    content: string;
    dopamine_score: number;
    confidence: number;
    tags: string[];
    access_count: number;
  }>;
  skills: Array<{
    id: string;
    condition: string;
    action: string;
    confidence: number;
    dopamine_score: number;
  }>;
  assessment: {
    difficulty: number;
    coverage_score: number;
    feeling_of_knowing: number;
    relevant_rules: number;
  };
}

export interface OGLearnResponse {
  experience_id: string;
  dopamine_level: number;
  consolidation_triggered: boolean;
  skill_count: number;
  hippocampus_size: number;
}

export interface OGModelOption {
  id: string;
  tier: "fast" | "balanced" | "powerful";
}

export interface OGAssessResponse {
  difficulty: number;
  coverage_score: number;
  feeling_of_knowing: number;
  relevant_rules: number;
  recommended_model: string | null;
  recommended_tier: string;
  uncertainty_flagged: boolean;
}

export interface OGVerifyResponse {
  passed: boolean;
  confidence: number;
  rationale: string;
  gaps: string[];
  corrections: string[];
  checks: {
    goal_alignment: boolean;
    completeness: boolean;
    non_vague: boolean;
    context_consistency: boolean;
  };
}

export interface OGConsolidateResponse {
  consolidated: boolean;
  reason?: string;
  clusters_found?: number;
  rules_crystallized?: number;
  rules_verified?: number;
  rules_deduplicated?: number;
  rules_pruned?: number;
  hebbian_connections_decayed?: number;
  hippocampus_size_after?: number;
  skill_count_after?: number;
  duration_ms?: number;
}

export interface OGHealthResponse {
  status: string;
  hippocampus_size: number;
  skill_count: number;
  dopamine_level: number;
  total_tasks: number;
}

export interface OGConfig {
  enabled: boolean;
  baseUrl: string;
  timeout: number;
  contextEnrichment: boolean;
  experienceCapture: boolean;
  resultVerification: boolean;
  smartRouting: boolean;
}

export class OGClient {
  constructor(
    private config: OGConfig,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number>,
  ): Promise<T | null> {
    if (!this.config.enabled) return null;

    try {
      let url = `${this.config.baseUrl}${path}`;
      if (params) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          search.set(key, String(value));
        }
        url += `?${search.toString()}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const resp = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.warn(`[og-client] ${method} ${path} returned ${resp.status}: ${text}`);
        return null;
      }

      return (await resp.json()) as T;
    } catch (err) {
      console.warn(`[og-client] ${method} ${path} failed:`, (err as Error).message);
      return null;
    }
  }

  async getContext(query: string, topK = 5): Promise<OGContextResponse | null> {
    return this.request<OGContextResponse>("GET", "/context", undefined, { query, top_k: topK });
  }

  async learn(
    query: string,
    result: string,
    success: boolean,
    opts?: {
      tags?: string[];
      tokenUsage?: { inputTokens: number; outputTokens: number };
      costUsd?: number;
      model?: string;
      durationMs?: number;
    },
  ): Promise<OGLearnResponse | null> {
    return this.request<OGLearnResponse>("POST", "/learn", {
      query,
      result,
      success,
      tags: opts?.tags,
      token_usage: opts?.tokenUsage,
      cost_usd: opts?.costUsd,
      model: opts?.model,
      duration_ms: opts?.durationMs,
    });
  }

  async assess(
    query: string,
    availableModels?: OGModelOption[],
  ): Promise<OGAssessResponse | null> {
    return this.request<OGAssessResponse>("POST", "/assess", {
      query,
      available_models: availableModels,
    });
  }

  async verify(
    query: string,
    result: string,
    opts?: { context?: string; strict?: boolean },
  ): Promise<OGVerifyResponse | null> {
    return this.request<OGVerifyResponse>("POST", "/verify", {
      query,
      result,
      context: opts?.context ?? "",
      strict: opts?.strict ?? false,
    });
  }

  async consolidate(force = false): Promise<OGConsolidateResponse | null> {
    return this.request<OGConsolidateResponse>("POST", "/consolidate", { force });
  }

  async health(): Promise<OGHealthResponse | null> {
    return this.request<OGHealthResponse>("GET", "/health");
  }
}

/** Build enriched system prompt from OG context response. */
export function buildEnrichedPrompt(
  systemPrompt: string | undefined,
  ogContext: OGContextResponse | null,
): string {
  if (!ogContext) return systemPrompt ?? "";

  const parts: string[] = [];
  if (systemPrompt) parts.push(systemPrompt);

  if (ogContext.experiences.length > 0) {
    parts.push("## Past Experience");
    for (const exp of ogContext.experiences) {
      parts.push(`- ${exp.content} (confidence: ${(exp.confidence * 100).toFixed(0)}%)`);
    }
  }

  if (ogContext.skills.length > 0) {
    parts.push("## Relevant Rules");
    for (const skill of ogContext.skills) {
      parts.push(`- IF "${skill.condition}" THEN "${skill.action}"`);
    }
  }

  return parts.join("\n\n");
}
