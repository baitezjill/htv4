export const ProviderPill = ({ id }: { id: 'chatgpt' | 'claude' | 'gemini' }) => {
  const cfg = {
    chatgpt: { emoji: '🟢', name: 'ChatGPT' },
    claude: { emoji: '🟠', name: 'Claude' },
    gemini: { emoji: '🔵', name: 'Gemini' }
  };
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
      {cfg[id].emoji} {cfg[id].name}
    </span>
  );
};