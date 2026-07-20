import { allocatePort } from '@linkcode/common/node';
import type { ScriptDeclaration } from './config';

type AllocatePort = () => Promise<number>;
type HostnameFor = (scriptName: string) => string;
type ProxyUrl = (hostname: string) => string | undefined;
const RE_ENV_KEY_SEPARATOR = /[^A-Z0-9]+/g;

export class ScriptPortPlan {
  private readonly ports = new Map<string, number>();
  private planning: Promise<void> | undefined;
  private readonly allocate: AllocatePort;

  constructor(
    allocate: AllocatePort | undefined,
    private readonly ensureAccepting: () => void,
  ) {
    this.allocate = allocate ?? allocatePort;
  }

  get(scriptName: string): number | undefined {
    return this.ports.get(scriptName);
  }

  async ensure(declarations: ScriptDeclaration[]): Promise<void> {
    if (this.planning) {
      await this.planning;
      return this.ensure(declarations);
    }
    const missing = declarations.filter(
      (declaration) => declaration.type === 'service' && !this.ports.has(declaration.name),
    );
    if (missing.length === 0) return;
    const planning = this.allocateMissing(missing);
    this.planning = planning;
    try {
      await planning;
    } finally {
      if (this.planning === planning) this.planning = undefined;
    }
    return this.ensure(declarations);
  }

  envFor(
    declaration: ScriptDeclaration,
    declarations: ScriptDeclaration[],
    hostnameFor: HostnameFor,
    proxyUrl: ProxyUrl,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    const selfPort = declaration.type === 'service' ? this.ports.get(declaration.name) : undefined;
    if (selfPort !== undefined) {
      env.LINKCODE_PORT = String(selfPort);
      const url = proxyUrl(hostnameFor(declaration.name));
      if (url) env.LINKCODE_URL = url;
    }
    for (const sibling of declarations) {
      if (sibling.type !== 'service') continue;
      const port = this.ports.get(sibling.name);
      if (port === undefined) continue;
      const key = sibling.name.toUpperCase().replaceAll(RE_ENV_KEY_SEPARATOR, '_');
      env[`LINKCODE_SERVICE_${key}_PORT`] = String(port);
      const url = proxyUrl(hostnameFor(sibling.name));
      if (url) env[`LINKCODE_SERVICE_${key}_URL`] = url;
    }
    return env;
  }

  private async allocateMissing(declarations: ScriptDeclaration[]): Promise<void> {
    for (const declaration of declarations) {
      // eslint-disable-next-line no-await-in-loop -- ports are allocated one at a time on purpose
      const port = declaration.preferredPort ?? (await this.allocate());
      this.ensureAccepting();
      this.ports.set(declaration.name, port);
    }
  }
}
