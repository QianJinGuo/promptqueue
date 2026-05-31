import { startServer } from "@promptqueue/server";
import { loadConfig } from "@promptqueue/server/config";

export async function startServe(options: { port?: number; config?: string }): Promise<void> {
  const config = loadConfig(options.config);
  const port = options.port ?? config.server.port;

  startServer({
    port,
    dbPath: config.storage.path,
    apiKey: process.env.PROMPTQUEUE_API_KEY,
    concurrency: config.server.concurrency,
  });
}
