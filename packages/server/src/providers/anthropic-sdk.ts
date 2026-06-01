import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderRequest,
  ProviderResponse,
  ProviderHealth,
  AgentRequest,
  AgentEvent,
  ToolExecutorFn,
  ToolDefinition,
  ProviderAdapter,
} from "@promptqueue/core";
import { logger } from "../logging.js";

const ANTHROPIC_SDK_MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;

export interface AnthropicSDKConfig {
  apiKey: string;
  defaultModel?: string;
  baseURL?: string;
}

export class AnthropicSDKProvider implements ProviderAdapter {
  readonly name = "anthropic-sdk";
  readonly models = ANTHROPIC_SDK_MODELS;
  private client: Anthropic;

  constructor(private config: AnthropicSDKConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const events = this.executeAgent({
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      model: request.model,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
    });

    let finalResponse: ProviderResponse | undefined;
    for await (const event of events) {
      if (event.type === "completed") {
        finalResponse = event.response;
      }
    }

    if (!finalResponse) {
      throw new Error(
        "AnthropicSDK provider did not produce a completed event",
      );
    }
    return finalResponse;
  }

  async *executeAgent(
    request: AgentRequest,
    signal?: AbortSignal,
    toolExecutor?: ToolExecutorFn,
  ): AsyncIterable<AgentEvent> {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: request.prompt },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turns = 0;
    const maxTurns = request.maxTurns ?? 10;
    const model =
      request.model ?? this.config.defaultModel ?? "claude-sonnet-4-6";
    const toolDefs = this.buildToolDefinitions(request.tools);

    while (turns < maxTurns) {
      turns++;

      if (signal?.aborted) {
        yield { type: "error", error: "Task was cancelled" };
        return;
      }

      try {
        const stream = this.client.messages.stream({
          model,
          max_tokens: request.maxTokens ?? 4096,
          system: request.systemPrompt ?? undefined,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          messages,
        });

        let fullText = "";
        const toolUseBlocks: Array<{
          id: string;
          name: string;
          input: unknown;
        }> = [];
        const assistantContent: Anthropic.ContentBlockParam[] = [];

        for await (const event of stream) {
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "tool_use") {
              toolUseBlocks.push({
                id: block.id,
                name: block.name,
                input: block.input,
              });
              assistantContent.push({
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
          }

          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              fullText += event.delta.text;
              yield { type: "text", content: event.delta.text };
            }
          }
        }

        // Add text to assistant content if present
        if (fullText) {
          assistantContent.unshift({ type: "text", text: fullText });
        }

        // Get final message for token counts
        const finalMessage = await stream.finalMessage();
        totalInputTokens += finalMessage.usage.input_tokens;
        totalOutputTokens += finalMessage.usage.output_tokens;

        // Process tool use blocks
        if (toolUseBlocks.length > 0) {
          for (const block of toolUseBlocks) {
            yield { type: "tool_call", name: block.name, args: block.input };

            if (toolExecutor) {
              const result = await toolExecutor(block.name, block.input);
              yield {
                type: "tool_result",
                name: block.name,
                result: result.content,
              };

              // Inject into conversation
              messages.push({
                role: "assistant",
                content: assistantContent,
              });
              messages.push({
                role: "user",
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: result.content,
                    is_error: result.isError ?? false,
                  } as Anthropic.ToolResultBlockParam,
                ],
              });
            }
          }

          if (toolExecutor) {
            continue; // Loop back for next turn
          }
          // No tool executor — just observe and end
        }

        // No tool use or no executor — we're done
        const costUsd = this.calculateCost(
          model,
          totalInputTokens,
          totalOutputTokens,
        );
        yield {
          type: "completed",
          response: {
            result: fullText,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            costUsd,
            model,
          },
        };
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`AnthropicSDK error: ${message}`);
        yield { type: "error", error: message };
        return;
      }
    }

    yield { type: "error", error: `Exceeded maximum turns (${maxTurns})` };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.client.messages.create({
        model: this.config.defaultModel ?? "claude-sonnet-4-6",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return { status: "healthy", latencyMs: Date.now() - start };
    } catch {
      return {
        status: "down",
        latencyMs: Date.now() - start,
        details: "API key invalid or service unavailable",
      };
    }
  }

  private buildToolDefinitions(
    tools?: ToolDefinition[],
  ): Anthropic.Tool[] {
    if (!tools || tools.length === 0) return [];
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: (tool.parameters ?? {
        type: "object",
        properties: {},
      }) as Anthropic.Tool.InputSchema,
    }));
  }

  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const pricing: Record<string, { input: number; output: number }> = {
      "claude-sonnet-4-6": { input: 3, output: 15 },
      "claude-opus-4-7": { input: 15, output: 75 },
    };
    const p = pricing[model] ?? { input: 3, output: 15 };
    return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  }
}