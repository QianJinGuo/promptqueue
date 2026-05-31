import { Command } from "commander";

const program = new Command();

program
  .name("promptqueue")
  .description("Async task queue for AI prompts")
  .version("0.1.0");

program
  .command("serve")
  .description("Start the PromptQueue server")
  .option("-p, --port <port>", "Server port")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    const { startServe } = await import("./commands/serve.js");
    await startServe({
      port: options.port ? parseInt(options.port, 10) : undefined,
      config: options.config,
    });
  });

program
  .command("submit <prompt>")
  .description("Submit a new task")
  .option("-m, --model <model>", "AI model to use")
  .option("-p, --priority <priority>", "Priority (1-5)", parseInt)
  .option("-q, --queue <queue>", "Queue name")
  .option("-s, --system-prompt <prompt>", "System prompt")
  .option("--max-tokens <tokens>", "Max response tokens", parseInt)
  .option("--temperature <temp>", "Sampling temperature", parseFloat)
  .option("--callback-url <url>", "Webhook callback URL")
  .option("--api-url <url>", "API server URL", "http://localhost:8080")
  .action(async (prompt, options) => {
    const { submitTask } = await import("./commands/submit.js");
    await submitTask(prompt, options);
  });

program
  .command("status <taskId>")
  .description("Check task status")
  .option("--api-url <url>", "API server URL", "http://localhost:8080")
  .action(async (taskId, options) => {
    const { checkStatus } = await import("./commands/status.js");
    await checkStatus(taskId, options);
  });

program
  .command("list")
  .description("List tasks")
  .option("-s, --status <status>", "Filter by status")
  .option("-q, --queue <queue>", "Filter by queue")
  .option("-p, --priority <priority>", "Filter by priority", parseInt)
  .option("-l, --limit <limit>", "Max tasks to show", parseInt)
  .option("--api-url <url>", "API server URL", "http://localhost:8080")
  .action(async (options) => {
    const { listTasks } = await import("./commands/list.js");
    await listTasks(options);
  });

program.parse();
