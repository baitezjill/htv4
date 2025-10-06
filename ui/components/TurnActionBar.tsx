import { LLM_PROVIDERS_CONFIG } from '../constants';

interface TurnActionBarProps {
  isLoading?: boolean;

  // Round identity
  roundUserTurnId: string;

  // Synthesis (multi-select)
  synthSelected: Record<string, boolean>;
  onToggleSynth: (roundUserTurnId: string, providerId: string) => void;
  onRunSynthesis: (roundUserTurnId: string) => void;
  // Think-mode toggle for ChatGPT synthesis
  thinkSynthForChatGPT?: boolean;
  onToggleThinkSynthForChatGPT?: (roundUserTurnId: string) => void;

  // Ensemble (single-select)
  ensembleSelected: string | null;
  onSelectEnsemble: (roundUserTurnId: string, providerId: string) => void;
  onRunEnsemble: (roundUserTurnId: string) => void;
  // Think-mode toggle for ChatGPT ensemble
  thinkEnsembleForChatGPT?: boolean;
  onToggleThinkEnsembleForChatGPT?: (roundUserTurnId: string) => void;

  // Per-provider grey-out
  eligibleMap?: Record<string, { disabled: boolean; reason?: string }>;
  // Ensemble-specific grey-out (separate from synthesis)
  ensembleEligibleMap?: Record<string, { disabled: boolean; reason?: string }>;

  // Optional guards
  disableSynthesisRun?: boolean;
  disableEnsembleRun?: boolean;
}

const TurnActionBar = ({
  isLoading = false,
  roundUserTurnId,
  synthSelected,
  onToggleSynth,
  onRunSynthesis,
  ensembleSelected,
  onSelectEnsemble,
  onRunEnsemble,
  eligibleMap = {},
  ensembleEligibleMap = {},
  disableSynthesisRun = false,
  disableEnsembleRun = false,
  thinkSynthForChatGPT = false,
  onToggleThinkSynthForChatGPT,
  thinkEnsembleForChatGPT = false,
  onToggleThinkEnsembleForChatGPT,
}: TurnActionBarProps) => {
  const renderToggle = (
    pid: string,
    isSelected: boolean,
    onClick: () => void,
    isDisabled: boolean,
    title: string,
    accentHex?: string
  ) => (
    <button
      key={pid}
      onClick={onClick}
      disabled={isDisabled || isLoading}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 999,
        border: isSelected && accentHex ? `1px solid ${accentHex}` : '1px solid #475569',
        background: isSelected
          ? (accentHex ? 'rgba(16,185,129,0.12)' : '#334155')
          : '#0f172a',
        color: isDisabled ? '#64748b' : '#e2e8f0',
        opacity: isDisabled ? 0.6 : 1,
        fontSize: 12,
        cursor: (isDisabled || isLoading) ? 'not-allowed' : 'pointer',
        boxShadow: isSelected && accentHex ? `0 0 0 2px ${accentHex}20` : undefined,
      }}
    >
      {isSelected ? '✓' : '○'} {LLM_PROVIDERS_CONFIG.find(p => p.id === pid)?.name || pid}
    </button>
  );

  return (
    <div
      className="turn-action-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px 14px',
        border: '1px solid #334155',
        background: '#1e293b',
        borderRadius: '12px',
        marginTop: '8px',
      }}
    >
      {/** Legacy "Synthesize with" controls temporarily disabled */}
      {false && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Synthesize with:</span>
          {LLM_PROVIDERS_CONFIG.map(p => {
            const isSelected = !!synthSelected[p.id];
            const block = eligibleMap[p.id];
            const isDisabled = !!block?.disabled;
            const title = block?.reason ? `${p.name}: ${block.reason}` : `Include ${p.name}`;
            return renderToggle(p.id, isSelected, () => onToggleSynth(roundUserTurnId, p.id), isDisabled, title);
          })}
          {/* Think-mode toggle for ChatGPT synthesis */}
          <button
            onClick={() => onToggleThinkSynthForChatGPT?.(roundUserTurnId)}
            disabled={isLoading}
            title={`Think mode for ChatGPT ${thinkSynthForChatGPT ? 'ON' : 'OFF'}`}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #475569',
              background: thinkSynthForChatGPT ? 'rgba(99,102,241,0.2)' : '#0f172a',
              color: '#e2e8f0',
              fontSize: 12,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            🤔 ChatGPT Think: {thinkSynthForChatGPT ? 'ON' : 'OFF'}
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => onRunSynthesis(roundUserTurnId)}
            disabled={isLoading || disableSynthesisRun}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #475569',
              background: '#334155',
              color: '#e2e8f0',
              fontSize: 12,
              cursor: (isLoading || disableSynthesisRun) ? 'not-allowed' : 'pointer'
            }}
          >
            ✨ Run
          </button>
        </div>
      )}

      {/** Legacy "Ensemble with" controls temporarily disabled */}
      {false && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Ensemble with:</span>
          {LLM_PROVIDERS_CONFIG.map(p => {
            const isSelected = ensembleSelected === p.id;
            const block = ensembleEligibleMap[p.id];
            const isDisabled = !!block?.disabled;
            const title = block?.reason ? `${p.name}: ${block.reason}` : `Choose ${p.name} to ensemble`;
            return renderToggle(
              p.id,
              isSelected,
              () => onSelectEnsemble(roundUserTurnId, p.id),
              isDisabled,
              title,
              '#10b981'
            );
          })}
          {/* Think-mode toggle for ChatGPT ensemble */}
          <button
            onClick={() => onToggleThinkEnsembleForChatGPT?.(roundUserTurnId)}
            disabled={isLoading}
            title={`Think mode for ChatGPT ${thinkEnsembleForChatGPT ? 'ON' : 'OFF'}`}
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid #475569',
              background: thinkEnsembleForChatGPT ? 'rgba(99,102,241,0.2)' : '#0f172a',
              color: '#e2e8f0',
              fontSize: 12,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            🤔 ChatGPT Think: {thinkEnsembleForChatGPT ? 'ON' : 'OFF'}
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => onRunEnsemble(roundUserTurnId)}
            disabled={isLoading || !ensembleSelected || disableEnsembleRun}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid #475569',
              background: '#334155',
              color: '#e2e8f0',
              fontSize: 12,
              cursor: (isLoading || !ensembleSelected || disableEnsembleRun) ? 'not-allowed' : 'pointer'
            }}
          >
            🧩 Run Ensemble
          </button>
        </div>
      )}
    </div>
  );
};

export default TurnActionBar;
  