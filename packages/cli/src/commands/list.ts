interface ListOptions {
  status?: string;
  queue?: string;
  priority?: number;
  limit?: number;
  apiUrl?: string;
}

export async function listTasks(options: ListOptions): Promise<void> {
  const apiUrl = options.apiUrl ?? "http://localhost:9090";

  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.queue) params.set("queue", options.queue);
  if (options.priority) params.set("priority", String(options.priority));
  if (options.limit) params.set("limit", String(options.limit));

  const url = `${apiUrl}/api/v1/tasks${params.toString() ? `?${params}` : ""}`;

  const response = await fetch(url);

  if (!response.ok) {
    console.error("Failed to list tasks:", response.statusText);
    process.exit(1);
  }

  const body = (await response.json()) as {
    data: Array<{
      id: string;
      status: string;
      prompt: string;
      model: string;
      priority: number;
      queue: string;
      createdAt: string;
    }>;
    meta: { total: number; page: number; limit: number };
  };

  if (body.data.length === 0) {
    console.log("No tasks found.");
    return;
  }

  console.log(`Tasks (${body.meta.total} total):\n`);
  console.log("ID".padEnd(28), "Status".padEnd(12), "Pri".padEnd(4), "Model".padEnd(22), "Prompt");
  console.log("-".repeat(90));

  for (const task of body.data) {
    const prompt = task.prompt.slice(0, 30).replace(/\n/g, " ");
    console.log(
      task.id.padEnd(28),
      task.status.padEnd(12),
      String(task.priority).padEnd(4),
      task.model.padEnd(22),
      prompt
    );
  }
}
