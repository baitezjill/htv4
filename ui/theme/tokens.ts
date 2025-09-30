// Centralized theme tokens for UI chrome elements used by the Rail to avoid hard-coded hex values
// Keep values aligned with existing UI styling

export const tokens = {
  rail: {
    bg: 'rgba(255, 255, 255, 0.04)',
    bgHover: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.1)',
    cardBg: 'rgba(255, 255, 255, 0.08)',
    cardBgHover: 'rgba(255, 255, 255, 0.12)',
    cardShadow: '0 1px 2px rgba(0,0,0,0.25)'
  },
  status: {
    streaming: '#10b981',
    unread: '#f59e0b',
    error: '#ef4444'
  },
  text: {
    muted: '#94a3b8'
  },
  accents: {
    chatgpt: '#10A37F',
    claude: '#FF7F00',
    gemini: '#4285F4',
    grok: '#9d71ff'
  }
} as const;
