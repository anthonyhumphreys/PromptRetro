import type {
  ProviderConfig,
  RetroInsight,
  RetroMetrics,
  SessionBundle,
  PatternMatch
} from "@prompt-retro/shared-types";
import { getProviderApiKey } from "./config.js";

export interface RetroPromptInput {
  bundle: SessionBundle;
  metrics: RetroMetrics;
  patterns: PatternMatch[];
}

export interface RetroProvider {
  analyze(input: RetroPromptInput): Promise<RetroInsight>;
}

function buildPrompt(input: RetroPromptInput): string {
  return JSON.stringify(
    {
      task: "Analyze this AI coding session as a retrospective coach.",
      requirements: [
        "Focus on developer interaction choices, not code review.",
        "Ground every point in the provided facts and patterns.",
        "Return JSON with keys: summary, whatWorked, whatToImprove, suggestions.",
        "Each suggestion must include kind, title, content."
      ],
      metrics: input.metrics,
      patterns: input.patterns,
      session: {
        session: input.bundle.session,
        turns: input.bundle.turns,
        corrections: input.bundle.corrections,
        toolCalls: input.bundle.toolCalls
      }
    },
    null,
    2
  );
}

function parseInsightResponse(raw: string): RetroInsight {
  const parsed = JSON.parse(raw) as Partial<RetroInsight>;
  return {
    summary: parsed.summary ?? "No summary returned.",
    whatWorked: parsed.whatWorked ?? [],
    whatToImprove: parsed.whatToImprove ?? [],
    suggestions: parsed.suggestions ?? []
  };
}

abstract class HttpRetroProvider implements RetroProvider {
  constructor(protected readonly config: ProviderConfig) {}

  protected abstract buildRequest(prompt: string, apiKey: string): RequestInit & { url: string };

  async analyze(input: RetroPromptInput): Promise<RetroInsight> {
    const apiKey = getProviderApiKey(this.config);
    if (!apiKey) {
      throw new Error(`Missing API key for provider "${this.config.provider}".`);
    }

    const request = this.buildRequest(buildPrompt(input), apiKey);
    const response = await fetch(request.url, request);
    if (!response.ok) {
      throw new Error(`Provider request failed with status ${response.status}.`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const content = this.extractText(body);
    return parseInsightResponse(content);
  }

  protected extractText(body: Record<string, unknown>): string {
    if (Array.isArray(body.content)) {
      const textBlock = body.content.find(
        (item) => typeof item === "object" && item !== null && "text" in item
      ) as { text?: string } | undefined;
      if (textBlock?.text) {
        return textBlock.text;
      }
    }

    const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
    if (choices?.[0]?.message?.content) {
      return choices[0].message.content;
    }

    throw new Error("Provider response did not contain a readable content block.");
  }
}

class AnthropicProvider extends HttpRetroProvider {
  protected buildRequest(prompt: string, apiKey: string): RequestInit & { url: string } {
    const url = this.config.baseUrl ?? "https://api.anthropic.com/v1/messages";
    return {
      url,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 1400,
        messages: [{ role: "user", content: prompt }]
      })
    };
  }
}

class OpenAiLikeProvider extends HttpRetroProvider {
  protected buildRequest(prompt: string, apiKey: string): RequestInit & { url: string } {
    const defaultUrl =
      this.config.provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";

    return {
      url: this.config.baseUrl ?? defaultUrl,
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }]
      })
    };
  }
}

export function createRetroProvider(config: ProviderConfig): RetroProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
    case "openrouter":
      return new OpenAiLikeProvider(config);
  }
}
