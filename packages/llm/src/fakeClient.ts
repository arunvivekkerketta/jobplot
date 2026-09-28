import type { GenerateStructuredParams, LLMClient } from "./types.js";

/**
 * Test double. Fixtures are queued per tag; each generateStructured call
 * consumes the next fixture for that tag (arrays allow multi-turn scenarios
 * such as invalid output followed by repaired output). Calling with no
 * fixture for the tag throws, so tests fail loudly instead of hitting network.
 */
export class FakeLLMClient implements LLMClient {
  readonly calls: Array<{ tag: string; user: string }> = [];

  constructor(
    private readonly fixtures: Map<string, unknown[]> = new Map(),
  ) {}

  /** Register one or more queued outputs for a tag. */
  fixture(tag: string, outputs: unknown | unknown[]): this {
    const queue = Array.isArray(outputs) ? outputs : [outputs];
    const existing = this.fixtures.get(tag) ?? [];
    this.fixtures.set(tag, [...existing, ...queue]);
    return this;
  }

  callsFor(tag: string): number {
    return this.calls.filter((c) => c.tag === tag).length;
  }

  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T> {
    this.calls.push({ tag: params.tag, user: params.user });
    const queue = this.fixtures.get(params.tag);
    if (!queue || queue.length === 0) {
      throw new Error(
        `FakeLLMClient has no fixture queued for tag "${params.tag}"`,
      );
    }
    const out = queue.shift();
    return params.schema.parse(out);
  }
}
