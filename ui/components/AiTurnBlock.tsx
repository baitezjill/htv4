import { AiTurn, ProviderResponse, AppStep } from '../types';
import { BotIcon } from './Icons';
import ProviderResponseBlock from './ProviderResponseBlock';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProviderPill } from './ProviderPill';

interface AiTurnBlockProps {
  aiTurn: AiTurn;
  isLive?: boolean;
  isReducedMotion?: boolean;
  currentAppStep?: AppStep;
  showSourceOutputs?: boolean;
  onToggleSourceOutputs?: () => void;
}

const AiTurnBlock = ({ 
  aiTurn, 
  isLive = false, 
  isReducedMotion = false, 
  currentAppStep,
  showSourceOutputs = false,
  onToggleSourceOutputs
}: AiTurnBlockProps) => {
  // Local UI state for the new Thinking/Ensemble disclosure and synthesis collapse
  const [showThinking, setShowThinking] = useState(false);
  const [showSynthesis, setShowSynthesis] = useState(true);
  const [showEnsembler, setShowEnsembler] = useState(true);

  // Read batch responses (GPT, Claude, Gemini)
  const batchResponses = useMemo(() => aiTurn.batchResponses || aiTurn.providerResponses || {}, [aiTurn.batchResponses, aiTurn.providerResponses]);
  
  // Read synthesis responses (can have multiple)
  const synthesisResponses = useMemo(() => aiTurn.synthesisResponses || {}, [aiTurn.synthesisResponses]);
  
  // Read ensemble responses (can have multiple)
  const ensembleResponses = useMemo(() => aiTurn.ensembleResponses || {}, [aiTurn.ensembleResponses]);

  const truncate = (s: string, n = 160) => (s && s.length > n) ? `${s.slice(0, n)}…` : s;
  
  // Determine if we should show batch responses (GPT, Claude, Gemini)
  const shouldShowBatchResponses = Object.keys(batchResponses).length > 0;
  
  // Determine if we should show synthesis responses
  const shouldShowSynthesisResponses = Object.keys(synthesisResponses).length > 0 || 
    (aiTurn.synthesisResponse && (aiTurn.synthesisResponse.text || aiTurn.synthesisResponse.status === 'streaming'));
  
  // Determine if we should show ensemble responses
  const shouldShowEnsembleResponses = Object.keys(ensembleResponses).length > 0 || 
    (aiTurn.ensembleResponse && (aiTurn.ensembleResponse.text || aiTurn.ensembleResponse.status === 'streaming'));

  // Section visibility helpers (used later in JSX)
  const shouldShowEnsembleSection = shouldShowEnsembleResponses || !!aiTurn.ensembleResponse;
  const ensembleText = Object.values(ensembleResponses).map(r => r.text || '').filter(Boolean).join('\n\n') || (aiTurn.ensembleResponse && aiTurn.ensembleResponse.text) || '';

  const hasSynthesisContent = shouldShowSynthesisResponses || (aiTurn.hiddenBatchOutputs && Object.keys(aiTurn.hiddenBatchOutputs).length > 0);

  return (
    <div className="ai-turn-block" style={{
      background: 'rgba(30, 41, 59, 0.6)',
      border: '1px solid #334155',
      borderRadius: '1rem',
      padding: '16px',
      overflow: 'visible',
      minHeight: '80px'
    }}>
      {/* AI Turn Header */}
      <div
        className="ai-turn-header"
        style={{
          display: 'flex',
          gap: '8px',
          padding: '8px 12px',
          background: aiTurn.isEnsembleAnswer ? 'rgba(16,185,129,0.08)' : 'rgba(139, 92, 246, 0.05)',
          border: '1px solid rgba(139, 92, 246, 0.1)',
          borderRadius: '12px',
        }}
      >
        <div
          className="ai-avatar"
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: aiTurn.isEnsembleAnswer ? 'rgba(16,185,129,0.2)' : 'rgba(139, 92, 246, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <BotIcon style={{ width: '18px', height: '18px', color: aiTurn.isEnsembleAnswer ? '#10b981' : '#8b5cf6' }} />
        </div>
        <div
          className="ai-turn-info"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: aiTurn.isEnsembleAnswer ? '#10b981' : '#8b5cf6',
            }}
          >
            {aiTurn.isEnsembleAnswer
              ? 'Ensemble Answer — Cross-validated'
              : aiTurn.isSynthesisAnswer
                ? 'Synthesis'
                : 'AI Response'} {isLive && '(Live)'}
          </div>
          <div
            style={{
              fontSize: '11px',
              color: '#94a3b8',
            }}
          >
            {new Date(aiTurn.createdAt).toLocaleTimeString()}
          </div>
        </div>
        {/* Hidden perspectives toggle removed */}
      </div>

      {/* BATCH RESPONSES: GPT, Claude, Gemini - Container 1, 2, 3 */}
      {shouldShowBatchResponses && (
        <div className="batch-responses-section" style={{ marginTop: '16px' }}>
          <ProviderResponseBlock
            providerResponses={batchResponses}
            isLoading={isLive}
            currentAppStep={currentAppStep || (isLive ? 'awaitingSynthesis' : 'synthesisDone')}
            isReducedMotion={isReducedMotion}
          />
        </div>
      )}

      {/* Round-level action bar is rendered under UserTurnBlock now */}

      {/* SYNTHESIS RESPONSES - Container 4 (Prominent) - Can have multiple syntheses */}
      {shouldShowSynthesisResponses && (
        <div className="synthesis-responses-container" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Render each synthesis response */}
          {Object.entries(synthesisResponses).map(([providerId, response]) => (
            <div
              key={`synthesis-${providerId}`}
              className="synthesis-section"
              style={{
                padding: '16px',
                backgroundColor: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid #334155',
                borderRadius: '1rem',
                position: 'relative',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#a78bfa',
                  marginBottom: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setShowSynthesis(v => !v)}
                    aria-expanded={showSynthesis}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#a78bfa',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {showSynthesis ? '▾' : '▸'}
                  </button>
                  Synthesis ({providerId.toUpperCase()})
                </span>
                {/* Sources arrow toggle (independent of synthesis visibility) */}
                {aiTurn.hiddenBatchOutputs && Object.keys(aiTurn.hiddenBatchOutputs).length > 0 && (
                  <button
                    onClick={onToggleSourceOutputs}
                    aria-expanded={!!showSourceOutputs}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: '6px',
                      padding: '2px 8px',
                      fontSize: '11px',
                      color: '#a78bfa',
                      cursor: 'pointer',
                    }}
                  >
                    {showSourceOutputs ? '▾ Sources' : '▸ Sources'}
                  </button>
                )}
              </div>
              {showSynthesis && (
                <div
                  style={{
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: '#e2e8f0',
                    whiteSpace: 'pre-wrap',
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '8px',
                    padding: '12px',
                  }}
                >
                  {response.text ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{response.text}</ReactMarkdown>
                  ) : (
                    <span className="streaming-dots" />
                  )}
                </div>
              )}
            </div>
          ))}
          {/* Fallback to legacy synthesisResponse if new format not available */}
          {Object.keys(synthesisResponses).length === 0 && aiTurn.synthesisResponse && (
            <div
              className="synthesis-section"
              style={{
                padding: '16px',
                backgroundColor: 'rgba(30, 41, 59, 0.6)',
                border: '1px solid #334155',
                borderRadius: '1rem',
                position: 'relative',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#a78bfa',
                  marginBottom: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => setShowSynthesis(v => !v)}
                    aria-expanded={showSynthesis}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#a78bfa',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {showSynthesis ? '▾' : '▸'}
                  </button>
                  Synthesis
                </span>
              </div>
              {showSynthesis && (
                <div
                  style={{
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: '#e2e8f0',
                    whiteSpace: 'pre-wrap',
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '8px',
                    padding: '12px',
                  }}
                >
                  {aiTurn.synthesisResponse.text ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiTurn.synthesisResponse.text}</ReactMarkdown>
                  ) : (
                    <span className="streaming-dots" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ensembler Response - separate block below Synthesis */}
      {shouldShowEnsembleSection && (
        <div
          className="ensemble-section"
          style={{
            marginTop: '12px',
            padding: '16px',
            backgroundColor: 'rgba(16, 185, 129, 0.06)',
            border: '1px solid #1e293b',
            borderRadius: '1rem',
            position: 'relative',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#10b981',
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setShowEnsembler(v => !v)}
                aria-expanded={showEnsembler}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#10b981',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {showEnsembler ? '▾' : '▸'}
              </button>
              Ensembler
            </span>
            {aiTurn.hiddenBatchOutputs && Object.keys(aiTurn.hiddenBatchOutputs).length > 0 && (
              <button
                onClick={onToggleSourceOutputs}
                aria-expanded={!!showSourceOutputs}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: '6px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  color: '#10b981',
                  cursor: 'pointer',
                }}
              >
                {showSourceOutputs ? '▾ Outputs' : '▸ Outputs'}
              </button>
            )}
          </div>
          {showEnsembler && (
            <div
              style={{
                fontSize: '13px',
                lineHeight: '1.5',
                color: '#e2e8f0',
                whiteSpace: 'pre-wrap',
                background: 'rgba(0, 0, 0, 0.25)',
                borderRadius: '8px',
                padding: '12px',
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{ensembleText}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {/* Hidden Source/Model Outputs - Collapsible section, always visible under Synthesis with toggle */}
      {hasSynthesisContent && (
        <div
          className="source-outputs-section"
          style={{
            marginTop: '16px',
            padding: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid #1e293b',
            borderRadius: '1rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#64748b',
              }}
            >
              Model Outputs
            </div>
            {aiTurn.hiddenBatchOutputs && Object.keys(aiTurn.hiddenBatchOutputs).length > 0 && (
              <button
                onClick={onToggleSourceOutputs}
                aria-expanded={!!showSourceOutputs}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(100,116,139,0.4)',
                  borderRadius: '6px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {showSourceOutputs ? '▾ Hide Outputs' : '▸ Show Outputs'}
              </button>
            )}
          </div>
          {aiTurn.hiddenBatchOutputs && Object.keys(aiTurn.hiddenBatchOutputs).length > 0 && showSourceOutputs ? (
            <div
              style={{
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              }}
            >
              {Object.entries(aiTurn.hiddenBatchOutputs).map(([providerId, providerResponse]) => (
                <div
                  key={providerId}
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '12px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#94a3b8',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {providerId}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      lineHeight: '1.4',
                      color: '#cbd5e1',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{providerResponse.text}</ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              {aiTurn.hiddenBatchOutputs && Object.keys(aiTurn.hiddenBatchOutputs).length > 0
                ? 'Outputs are hidden. Use the toggle to reveal them.'
                : 'No hidden batch outputs yet'}
            </div>
          )}
        </div>
      )}

      {/* Hidden perspectives panel removed */}
    </div>
  );
};

export default AiTurnBlock;