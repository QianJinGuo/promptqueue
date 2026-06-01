interface SubmitOptions {
  model?: string;
  priority?: number;
  queue?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  callbackUrl?: string;
  apiUrl?: string;
}

export async function submitTask(prompt: string, options: SubmitOptions): Promise<void> {
  const apiUrl = options.apiUrl ?? "http://localhost:9090";

  const response = await fetch(`${apiUrl}/api/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      model: options.model,
      priority: options.priority,
      queue: options.queue,
      systemPrompt: options.systemPrompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      callbackUrl: options.callbackUrl,
      tools: options.tools ? { enabled: true } : undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    console.error("Failed to submit task:", (error as Record<string, unknown>).error ?? response.statusText);
    process.exit(1);
  }

  const body = (await response.json()) as { data: { id: string; status: string } };
  console.log(`Task submitted: ${body.data.id} (status: ${body.data.status})`);
}
