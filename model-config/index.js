export const DEFAULT_MODELS = Object.freeze({
  OPENAI: 'gpt-5.4-mini',
  ANTHROPIC: 'claude-3-5-sonnet-latest',
  GEMINI: 'gemini-2.5-flash',
  NANO_BANANA: 'gemini-2.5-flash-image',
  VEO: 'veo-3.1-fast-generate-preview',
});

export const MODEL_FALLBACKS = Object.freeze({
  GEMINI_CHAT: DEFAULT_MODELS.GEMINI,
});
