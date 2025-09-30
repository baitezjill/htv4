import { LLMProvider } from './types';

import { INITIAL_PROVIDERS } from './providers/providerRegistry';

export const LLM_PROVIDERS_CONFIG: LLMProvider[] = [
  ...INITIAL_PROVIDERS
];

export const SIMULATION_CHUNK_DELAY_MS = 70;
export const FIRST_SENTENCE_SUMMARY_CHUNKS = 8;
export const FULL_OUTPUT_CHUNKS = 30;
export const OVERALL_SUMMARY_CHUNKS = 15;

export const EXAMPLE_PROMPT = "Explain the concept of quantum entanglement in simple terms.";

export const STREAMING_PLACEHOLDER = ""; // CSS will handle visual streaming indicators (pulsing dots)
