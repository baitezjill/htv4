import { LLMProvider } from './types';


export const AI_THINK_FLAG = 't';
export const O1_TOOL_NAME = 'a8km123';

export const LLM_PROVIDERS_CONFIG: LLMProvider[] = [
  { id: 'chatgpt', name: 'ChatGPT', color: '#10A37F', logoBgClass: 'bg-green-500', hostnames: ['chat.openai.com','chatgpt.com'] },
  { id: 'claude', name: 'Claude', color: '#FF7F00', logoBgClass: 'bg-orange-500', hostnames: ['claude.ai'] },
  { id: 'gemini', name: 'Gemini', color: '#4285F4', logoBgClass: 'bg-blue-500', hostnames: ['gemini.google.com'] },
];

export const SIMULATION_CHUNK_DELAY_MS = 70;
export const FIRST_SENTENCE_SUMMARY_CHUNKS = 8;
export const FULL_OUTPUT_CHUNKS = 30;
export const OVERALL_SUMMARY_CHUNKS = 15;

export const EXAMPLE_PROMPT = "Explain the concept of quantum entanglement in simple terms.";

export const STREAMING_PLACEHOLDER = ""; // CSS will handle visual streaming indicators (pulsing dots)
