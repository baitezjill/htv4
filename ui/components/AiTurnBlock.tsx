import { AiTurn, ProviderResponse, AppStep } from '../types';
import { BotIcon } from './Icons';
import ProviderResponseBlock from './ProviderResponseBlock';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProviderPill } from './ProviderPill';
import { hasComposableContent } from '../utils/composerUtils';

interface AiTurnBlockProps {
  aiTurn: AiTurn;
  isLive?: boolean;
  isReducedMotion?: boolean;
  currentAppStep?: AppStep;
  showSourceOutputs?: boolean;
  onToggleSourceOutputs?: () => void;
  onEnterComposerMode?: (aiTurn: AiTurn) => void;
}

const AiTurnBlock = ({ 
  aiTurn, 
  isLive = false, 
  isReducedMotion = false, 
  currentAppStep,
  showSourceOutputs = false,
  onToggleSourceOutputs,
  onEnterComposerMode
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
  
  // Merge batchResponses and hiddenBatchOutputs to ensure all batch outputs are displayed
  const mergedBatchOutputs = useMemo(() => {
    const merged: Record<string, any> = {};
    
    // Add batchResponses
    Object.entries(batchResponses).forEach(([providerId, response]) => {
      merged[providerId] = response;
    });
    
    // Add hiddenBatchOutputs (may override or add to batchResponses)
    if (aiTurn.hiddenBatchOutputs) {
      Object.entries(aiTurn.hiddenBatchOutputs).forEach(([providerId, response]) => {
        // Convert hiddenBatchOutputs format to ProviderResponse format if needed
        if (typeof response === 'string') {
          merged[providerId] = {
            providerId,
            text: response,
            status: 'completed',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
        } else {
          merged[providerId] = response;
        }
      });
    }
    
    return merged;
  }, [batchResponses, aiTurn.hiddenBatchOutputs]);

  // Determine if we should show batch responses (GPT, Claude, Gemini)
  const shouldShowBatchResponses = Object.keys(batchResponses).length > 0;
  
  // Determine if we should show synthesis responses
  const shouldShowSynthesisResponses = Object.keys(synthesisResponses).length > 0 || 
    (aiTurn.synthesisResponse && (aiTurn.synthesisResponse.text || aiTurn.synthesisResponse.status === 'streaming'));
  
  // Determine if we should show ensemble responses
  const shouldShowEnsembleResponses = Object.keys(ensembleResponses).length > 0 || 
    (aiTurn.ensembleResponse && (aiTurn.ensembleResponse.text || aiTurn.ensembleResponse.status === 'streaming'));

  const shouldShowHiddenBatchOutputs = Object.keys(mergedBatchOutputs).length > 0;

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
      </div>

      {/* 6-STEP WORKFLOW: Side-by-side Layout Implementation */}
      <div className="workflow-layout" style={{ marginTop: '16px' }}>
        
        {/* PHASE 1: 2-Column Layout - Batch Responses + Synthesis */}
        {(shouldShowBatchResponses || shouldShowSynthesisResponses) && (
          <div className="phase-1-layout" style={{ 
            display: 'grid', 
            gridTemplateColumns: shouldShowBatchResponses && shouldShowSynthesisResponses ? '1fr 1fr' : '1fr',
            gap: '16px',
            marginBottom: '16px'
          }}>
            
            {/* Column 1: Batch Responses */}
            {shouldShowBatchResponses && (
              <div className="batch-responses-column">
                <ProviderResponseBlock
                  providerResponses={batchResponses}
                  isLoading={isLive}
                  currentAppStep={currentAppStep || (isLive ? 'awaitingSynthesis' : 'synthesisDone')}
                  isReducedMotion={isReducedMotion}
                />
              </div>
            )}

            {/* Column 2: Synthesis Responses */}
            {shouldShowSynthesisResponses && (
              <div className="synthesis-responses-column">
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
          </div>
        )}

        {/* PHASE 2: 3-Column Layout - Synthesis + Ensemble + Hidden Batch */}
        {shouldShowEnsembleSection && (
          <div className="phase-2-layout" style={{ 
            display: 'grid', 
            gridTemplateColumns: shouldShowSynthesisResponses ? '1fr 1fr 1fr' : '1fr 1fr',
            gap: '16px',
            marginBottom: '16px'
          }}>
            
            {/* Column 1: Synthesis (repeated for side-by-side with ensemble) */}
            {shouldShowSynthesisResponses && (
              <div className="synthesis-repeat-column">
                {Object.entries(synthesisResponses).map(([providerId, response]) => (
                  <div
                    key={`synthesis-repeat-${providerId}`}
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
                      }}
                    >
                      <span>Synthesis ({providerId.toUpperCase()})</span>
                    </div>
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
                  </div>
                ))}
                
                {/* Fallback for legacy synthesis */}
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
                      }}
                    >
                      <span>Synthesis</span>
                    </div>
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
                  </div>
                )}
              </div>
            )}

            {/* Column 2: Ensemble Responses */}
            <div className="ensemble-responses-column">
              <div
                className="ensemble-section"
                style={{
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
            </div>

            {/* Column 3: Hidden Batch Outputs */}
            <div className="hidden-batch-column">
              {shouldShowHiddenBatchOutputs && (
                <div
                  className="hidden-batch-section"
                  style={{
                    padding: '16px',
                    backgroundColor: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid #1e293b',
                    borderRadius: '1rem',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#64748b',
                      marginBottom: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={onToggleSourceOutputs}
                        aria-expanded={!!showSourceOutputs}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#64748b',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        {showSourceOutputs ? '▾' : '▸'}
                      </button>
                      All Batch Outputs
                    </span>
                  </div>
                  {showSourceOutputs && (
                    <div
                      style={{
                        display: 'grid',
                        gap: '12px',
                        gridTemplateColumns: '1fr',
                      }}
                    >
                      {Object.entries(mergedBatchOutputs).map(([providerId, providerResponse]) => (
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
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{providerResponse.text || providerResponse}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Composer Mode Entry Button */}
      {!isLive && hasComposableContent(aiTurn) && onEnterComposerMode && (
        <div style={{ marginTop: '16px' }}>
          <button
            onClick={() => onEnterComposerMode(aiTurn)}
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 20px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 16px rgba(139, 92, 246, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
            }}
          >
            <span style={{ fontSize: '18px' }}>✨</span>
            Open in Composer Mode
            <span style={{ fontSize: '18px' }}>→</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default AiTurnBlock;