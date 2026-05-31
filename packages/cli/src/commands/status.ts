export async function checkStatus(taskId: string, options: { apiUrl?: string }): Promise<void> {
  const apiUrl = options.apiUrl ?? "http://localhost:8080";

  const response = await fetch(`${apiUrl}/api/v1/tasks/${taskId}`);

  if (!response.ok) {
    if (response.status === 404) {
      console.error(`Task not found: ${taskId}`);
    } else {
      console.error("Failed to get task status:", response.statusText);
    }
    process.exit(1);
  }

  const body = (await response.json()) as {
    data: {
      id: string;
      status: string;
      prompt: string;
      model: string;
      result?: string;
      error?: string;
      tokenUsage?: { inputTokens: number; outputTokens: number };
      costUsd?: number;
      createdAt: string;
      completedAt?: string;
    };
  };

  const task = body.data;
  console.log(`Task: ${task.id}`);
  console.log(`Status: ${task.status}`);
  console.log(`Model: ${task.model}`);
  console.log(`Prompt: ${task.prompt.slice(0, 100)}${task.prompt.length > 100 ? "..." : ""}`);

  if (task.result) {
    console.log(`Result: ${task.result.slice(0, 500)}${task.result.length > 500 ? "..." : ""}`);
  }
  if (task.error) {
    console.log(`Error: ${task.error}`);
  }
  if (task.tokenUsage) {
    console.log(`Tokens: ${task.tokenUsage.inputTokens} in / ${task.tokenUsage.outputTokens} out`);
  }
  if (task.costUsd !== undefined) {
    console.log(`Cost: $${task.costUsd.toFixed(6)}`);
  }
}
