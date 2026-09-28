import { LogProvider, ProviderStatus } from '../types.js';
import { SeqProvider } from './seq.js';
import { OpenObserveProvider } from './openobserve.js';

export const openObserveProvider = new OpenObserveProvider();

class ProviderRegistry {
  private providers: Map<string, LogProvider> = new Map();

  constructor() {
    this.register(new SeqProvider());
    this.register(openObserveProvider);
  }

  public register(provider: LogProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  public get(name: string): LogProvider | undefined {
    const key = name.toLowerCase();
    return this.providers.get(key === 'observe' ? 'openobserve' : key);
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
