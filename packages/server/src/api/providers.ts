import { Hono } from "hono";
import type { ProviderRegistry } from "../providers/registry.js";

interface Env {
  Variables: {
    providerRegistry: ProviderRegistry;
  };
}

const providers = new Hono<Env>();

providers.get("/", async (c) => {
  const registry = c.get("providerRegistry");
  const providerList = registry.listProviders().map((p) => ({
    name: p.name,
    models: p.models,
  }));

  return c.json({ success: true, data: providerList, error: null });
});

providers.get("/:id/health", async (c) => {
  const { id } = c.req.param();
  const registry = c.get("providerRegistry");

  const provider = registry.getProvider(id);
  if (!provider) {
    return c.json({ success: false, data: null, error: "Provider not found" }, 404);
  }

  const health = await provider.healthCheck();
  return c.json({ success: true, data: health, error: null });
});

export { providers };
