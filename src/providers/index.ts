import { LogProvider, ProviderStatus } from '../types.js';
import { SeqProvider } from './seq.js';
import { ObserveProvider } from './observe.js';

class ProviderRegistry {
  private providers: Map<string, LogProvider> = new Map();

  constructor() {
    this.register(new SeqProvider());
    this.register(new ObserveProvider());
  }

  public register(provider: LogProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  public get(name: string): LogProvider | undefined {
    return this.providers.get(name.toLowerCase());
  }

  public getAll(): LogProvider[] {
    return Array.from(this.providers.values());
  }

  public listStatuses(): ProviderStatus[] {
    return this.getAll().map((p) => p.getStatus());
  }
}

export const registry = new ProviderRegistry();
export const getProvider = (name: string) => registry.get(name);
export const getAllProviders = () => registry.getAll();
export const listProviders = () => registry.listStatuses();
