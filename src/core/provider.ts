export interface LLMRequest {
  model: string;
  messages: unknown[];
  tools?: unknown[];
}

export interface LLMResponse {
  content: unknown;
  stopReason?: string;
}

export interface LLMProvider {
  readonly name: string;
  invoke(req: LLMRequest): Promise<LLMResponse>;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): LLMProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unknown provider: ${name}`);
    }
    return provider;
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
