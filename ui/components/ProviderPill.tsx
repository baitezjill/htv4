import { getProviderById } from '../providers/providerRegistry';

export const ProviderPill = ({ id }: { id: string }) => {
  // Local fallback map for known providers; registry is authoritative if present
  const fallback = {
    chatgpt: { emoji: '🟢', name: 'ChatGPT' },
    claude:  { emoji: '🟠', name: 'Claude' },
    gemini:  { emoji: '🔵', name: 'Gemini' },
    grok:    { emoji: '🚀', name: 'Grok' },
  } as Record<string, { emoji: string; name: string }>;

  const prov = getProviderById(id);
  const emoji = (prov as any)?.emoji || fallback[id]?.emoji || '🤖';
  const name  = prov?.name || fallback[id]?.name || (id || 'Unknown');

  return (
    <span className="provider-pill" style={{
      fontSize: '10px',
      backgroundColor: 'rgba(15, 23, 42, 0.5)', // bg-slate-900/50
      padding: '2px 6px',
      borderRadius: '4px',
      color: '#e2e8f0',
      fontWeight: '500',
      lineHeight: '1.2',
      marginLeft: 'auto',
      alignSelf: 'flex-end',
      marginTop: '8px',
    }}>
      {emoji} {name}
    </span>
  );
};
