export interface SecretResolver {
  resolve(name: string): Promise<string | undefined>;
}

export class EnvironmentSecretResolver implements SecretResolver {
  async resolve(name: string): Promise<string | undefined> {
    return process.env[name];
  }
}

export const environmentSecretResolver = new EnvironmentSecretResolver();
