import type { LLMProvider } from '../types';

// Provider icons are light-weight and color-driven via tokens to remain dark-mode safe
import { ChatGPTIcon, ClaudeIcon, GeminiIcon, QwenIcon } from './providerIcons';

// Central registry for provider metadata used by the UI (lanes/rail)
// - Do NOT hard-code hex colors inside Rail; colors live here (or in tokens)
// - This module exposes addProvider for future dynamic extension

export interface ProviderConfig extends LLMProvider {
  // Icon component for micro-cards and badges
  icon?: (props: { size?: number; style?: React.CSSProperties }) => JSX.Element;
}

// Initial providers (seeded). This is the only place you should edit to add a new provider by config-only.
export const INITIAL_PROVIDERS: ProviderConfig[] = [
  { id: 'chatgpt', name: 'ChatGPT', color: '#10A37F', logoBgClass: 'bg-green-500', hostnames: ['chat.openai.com','chatgpt.com'], icon: ChatGPTIcon },
  { id: 'claude',  name: 'Claude',  color: '#FF7F00', logoBgClass: 'bg-orange-500', hostnames: ['claude.ai'],                   icon: ClaudeIcon },
  { id: 'gemini',  name: 'Gemini',  color: '#4285F4', logoBgClass: 'bg-blue-500',   hostnames: ['gemini.google.com'],           icon: GeminiIcon },
  { id: 'qwen',    name: 'Qwen',    color: '#00A9E0', logoBgClass: 'bg-cyan-500', hostnames: ['tongyi.aliyun.com'],           icon: QwenIcon, emoji: '🤖' },
];

// Mutable list used by the LaneFactory/Rail
let providers: ProviderConfig[] = [...INITIAL_PROVIDERS];

export function getProviders(): ProviderConfig[] {
  return providers;
}

export function getProviderById(id: string): ProviderConfig | undefined {
  return providers.find(p => p.id === id);
}

// Add a provider at runtime. Higher layers can call this once adapter is available.
export function addProvider(p: ProviderConfig): void {
  if (!p || !p.id) return;
  // De-duplicate by id
  providers = [
    ...providers.filter(x => x.id !== p.id),
    p,
  ];
}