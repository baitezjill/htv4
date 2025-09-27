import { useState, useEffect, useRef } from 'react';

interface ChatInputProps {
  onSendPrompt: (prompt: string) => void;
  onContinuation: (prompt: string) => void;
  isLoading: boolean;
  isReducedMotion?: boolean;
  activeProviderCount: number;
  isVisibleMode: boolean;
  isContinuationMode: boolean;
  // Ensemble-specific
  onStartEnsemble?: (prompt: string) => void;
  canShowEnsemble?: boolean; // ModelTray has >=2 selected and prompt has content
  ensembleTooltip?: string;
  ensembleActive?: boolean; // disable input and toggles while active
}

const ChatInput = ({
    onSendPrompt,
    onContinuation,
    isLoading,
    isReducedMotion = false,
    activeProviderCount,
    isVisibleMode,
    isContinuationMode,
    onStartEnsemble,
    canShowEnsemble = false,
    ensembleTooltip,
    ensembleActive = false,
}: ChatInputProps) => {
  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'; // Reset height
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`; // Max height 120px
    }
  }, [prompt]);

  const handleSubmit = (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (isLoading || !prompt.trim()) return;

    const trimmed = prompt.trim();
    if (isContinuationMode) {
      onContinuation(trimmed);
    } else {
      onSendPrompt(trimmed);
    }
    setPrompt("");
    setSaved(true);
    setTimeout(() => setSaved(false), 600);
  };
  
  const buttonText = isContinuationMode ? 'Continue' : 'Send';
  const isDisabled = isLoading || ensembleActive || !prompt.trim();
  const showEnsembleBtn = canShowEnsemble && !!prompt.trim();

  // Status color for system pill
  const statusColor = isLoading ? '#f59e0b' : '#10b981';

  return (
    <div className="input-area" style={{
      padding: '15px 20px', background: 'rgba(15, 15, 35, 0.8)',
      backdropFilter: 'blur(10px)', borderTop: '1px solid rgba(255, 255, 255, 0.1)'
    }}>
      <div className="input-container" style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', position: 'relative' }}>
        

        <div className="input-wrapper" style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
            placeholder={
              isContinuationMode
                ? "Continue the conversation with your follow-up message..."
                : "Ask anything... Sidecar will orchestrate multiple AI models for you."
            }
            rows={1}
            className="prompt-textarea"
            style={{
              width: '100%', minHeight: '44px', padding: '12px 16px',
              background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '12px', color: '#f1f5f9', fontSize: '14px', fontFamily: 'inherit',
              resize: 'none', outline: 'none', transition: isReducedMotion ? undefined : 'all 0.2s ease',
              overflowY: 'auto'
            }}
            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={isLoading}
          />
        </div>

        {/* System status pill (minimal) to the right of the input */}
        <div
          className="system-pill"
          role="status"
          aria-live="polite"
          title={`System: ${isLoading ? 'Working…' : 'Ready'} • Providers: ${activeProviderCount} • Mode: ${isVisibleMode ? 'Visible' : 'Headless'}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 10px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '999px',
            color: '#cbd5e1',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            opacity: 0.9,
            cursor: 'default'
          }}
        >
          <span aria-hidden="true" style={{
            display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: statusColor,
            animation: isLoading || !isReducedMotion ? 'pulse 1.5s ease-in-out infinite' : undefined
          }} />
          <span style={{ color: '#94a3b8' }}>System</span>
          <span>• {activeProviderCount}</span>
        </div>

        {/* Send Button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isDisabled}
          className="action-button"
          style={{
            padding: '0px 16px', height: '44px',
            background: 'linear-gradient(45deg, #6366f1, #8b5cf6)', border: 'none',
            borderRadius: '12px', color: 'white', fontWeight: 600, cursor: 'pointer',
            transition: isReducedMotion ? undefined : 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '8px',
            minWidth: '100px', justifyContent: 'center',
            opacity: isDisabled ? 0.5 : 1
          }}
        >
          {isLoading ? (
            <div className="loading-spinner"></div>
          ) : saved ? (
            '✓'
          ) : (
            <>
              <span className="magic-icon" style={{ fontSize: '16px' }}>
                {isContinuationMode ? '💬' : '✨'}
              </span>
              <span>{buttonText}</span>
            </>
          )}
        </button>
        
        {/* Ensemble Button (ChatInput path) */}
        {showEnsembleBtn && (
          <button
            type="button"
            onClick={() => { onStartEnsemble?.(prompt.trim()); setPrompt(""); }}
            disabled={isLoading || ensembleActive}
            title={ensembleTooltip || 'Ensemble with selected models'}
            style={{
              padding: '0px 14px', height: '44px',
              background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '12px', color: '#e2e8f0', fontWeight: 600, cursor: 'pointer',
              transition: isReducedMotion ? undefined : 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '8px',
              minWidth: '120px', justifyContent: 'center',
              opacity: (isLoading || ensembleActive) ? 0.5 : 1
            }}
          >
            <span style={{ fontSize: '16px' }}>🧩</span>
            <span>Ensemble</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatInput;