export declare const DEFAULT_MODELS: Readonly<{
  OPENAI: string;
  ANTHROPIC: string;
  GEMINI: string;
  NANO_BANANA: string;
  VEO: string;
}>;

export declare const MODEL_FALLBACKS: Readonly<{
  GEMINI_CHAT: typeof DEFAULT_MODELS.GEMINI;
}>;
