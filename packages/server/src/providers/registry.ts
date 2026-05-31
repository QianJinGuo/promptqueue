import type { ProviderAdapter } from "@promptqueue/core";

export class ProviderRegistry {
  private providers = new Map<string, ProviderAdapter>();
  private modelToProvider = new Map<string, ProviderAdapter>();

  register(provider: ProviderAdapter): void {
    this.providers.set(provider.name, provider);
    for (const model of provider.models) {
      this.modelToProvider.set(model, provider);
    }
  }

  resolve(model: string): ProviderAdapter {
    const provider = this.modelToProvider.get(model);
    if (!provider) {
      throw new Error(`No provider found for model: ${model}`);
    }
    return provider;
  }

  getProvider(name: string): ProviderAdapter | undefined {
    return this.providers.get(name);
  }

  listProviders(): ProviderAdapter[] {
    return Array.from(this.providers.values());
  }
}
