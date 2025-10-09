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
  isLoading?: boolean;
  currentAppStep?: AppStep;
  showSourceOutputs?: boolean;
  onToggleSourceOutputs?: () => void;
  onEnterComposerMode?: (aiTurn: AiTurn) => void;
}

const AiTurnBlock: React.FC<AiTurnBlockProps> = ({ 
  aiTurn, 
  onToggleSourceOutputs, 
  showSourceOutputs = false,
  onEnterComposerMode,
  isReducedMotion = false,
  isLoading = false,
  currentAppStep
}) => {
  // Local UI state
  const [showSynthesisCollapse, setShowSynthesisCollapse] = useState(false);
  const [showEnsembleCollapse, setShowEnsembleCollapse] = useState(false);

  // Prepare primary content (synthesis and ensemble)
  const synthesisResponses = useMemo(() => {
    const map = aiTurn.synthesisResponses || {};
    const out: Record<string, ProviderResponse[]> = {};
    Object.entries(map as Record<string, any>).forEach(([pid, resp]) => {
      out[pid] = Array.isArray(resp) ? resp : [resp as ProviderResponse];
    });
    return out;
  }, [aiTurn.synthesisResponses]);

  const ensembleResponses = useMemo(() => {
    const map = aiTurn.ensembleResponses || {};
    const out: Record<string, ProviderResponse[]> = {};
    Object.entries(map as Record<string, any>).forEach(([pid, resp]) => {
      out[pid] = Array.isArray(resp) ? resp : [resp as ProviderResponse];
    });
    return out;
  }, [aiTurn.ensembleResponses]);

  // Prepare source content (combine batch and hidden outputs)
  const allSources = useMemo(() => {
    const sources = { ...(aiTurn.batchResponses || {}) };
    
    // Add hidden batch outputs to sources
    if (aiTurn.hiddenBatchOutputs) {
      Object.entries(aiTurn.hiddenBatchOutputs).forEach(([providerId, text]) => {
        if (!sources[providerId]) {
          sources[providerId] = {
            providerId,
            text: typeof text === 'string' ? text : text?.text || '',
            status: 'completed' as const,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
        }
      });
    }
    
    return sources;
  }, [aiTurn.batchResponses, aiTurn.hiddenBatchOutputs]);

  // Simple boolean checks for what to display
  const hasSynthesis = Object.keys(synthesisResponses).length > 0;
  const hasEnsemble = Object.keys(ensembleResponses).length > 0;
  const hasSources = Object.keys(allSources).length > 0;
  const hasPrimaryContent = hasSynthesis || hasEnsemble;

  // Determine header text
  const getHeaderText = () => {
    if (hasEnsemble && hasSynthesis) return "AI Response";
    if (hasEnsemble) return "Ensemble Answer";
    if (hasSynthesis) return "Synthesis";
    return "AI Response";
  };

  return (
    <div className="ai-turn-block">
      {/* Header */}
      <div className="ai-turn-header">
        <h3>{getHeaderText()}</h3>
      </div>

      <div className="ai-turn-content">
        {/* Primary Content: Synthesis and Ensemble side-by-side */}
        {hasPrimaryContent && (
          <div className="primary-content-section">
            <div className="synthesis-ensemble-row" style={{ 
              display: 'flex', 
              gap: '16px',
              marginBottom: '16px'
            }}>
              {/* Synthesis Section */}
              {hasSynthesis && (
                <div className="synthesis-section" style={{ 
                  flex: hasEnsemble ? 1 : 2,
                  border: '1px solid #e1e5e9',
                  borderRadius: '8px',
                  padding: '16px'
                }}>
                  <div className="section-header" style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Synthesis</h4>
                    <button 
                      onClick={() => setShowSynthesisCollapse(!showSynthesisCollapse)}
                      className="collapse-button"
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {showSynthesisCollapse ? '▼' : '▶'}
                    </button>
                  </div>
                  {!showSynthesisCollapse && (
                    <div className="synthesis-content">
                      {Object.entries(synthesisResponses).flatMap(([pid, responses]) => (
                        responses.map((response, index) => (
                          <div key={`synthesis-${pid}-${index}`} className="provider-response" style={{ marginBottom: '12px' }}>
                            <div className="provider-header" style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              marginBottom: '8px',
                              fontSize: '12px',
                              color: '#666'
                            }}>
                              <span className="provider-name">{response.providerId || pid}</span>
                              <span className="provider-status">{response.status}</span>
                            </div>
                            <div className="response-text" style={{ 
                              whiteSpace: 'pre-wrap',
                              lineHeight: '1.5'
                            }}>
                              {response.text}
                            </div>
                          </div>
                        ))
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Ensemble Section */}
              {hasEnsemble && (
                <div className="ensemble-section" style={{ 
                  flex: hasSynthesis ? 1 : 2,
                  border: '1px solid #e1e5e9',
                  borderRadius: '8px',
                  padding: '16px'
                }}>
                  <div className="section-header" style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Ensemble</h4>
                    <button 
                      onClick={() => setShowEnsembleCollapse(!showEnsembleCollapse)}
                      className="collapse-button"
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {showEnsembleCollapse ? '▼' : '▶'}
                    </button>
                  </div>
                  {!showEnsembleCollapse && (
                    <div className="ensemble-content">
                      {Object.entries(ensembleResponses).flatMap(([pid, responses]) => (
                        responses.map((response, index) => (
                          <div key={`ensemble-${pid}-${index}`} className="provider-response" style={{ marginBottom: '12px' }}>
                            <div className="provider-header" style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              marginBottom: '8px',
                              fontSize: '12px',
                              color: '#666'
                            }}>
                              <span className="provider-name">{response.providerId || pid}</span>
                              <span className="provider-status">{response.status}</span>
                            </div>
                            <div className="response-text" style={{ 
                              whiteSpace: 'pre-wrap',
                              lineHeight: '1.5'
                            }}>
                              {response.text}
                            </div>
                          </div>
                        ))
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sources Toggle - appears under primary content */}
            {hasSources && (
              <div className="sources-toggle-section" style={{ 
                textAlign: 'center',
                marginBottom: '16px'
              }}>
                <button 
                  onClick={() => onToggleSourceOutputs?.()}
                  className="toggle-button"
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  {showSourceOutputs ? 'Hide Sources' : 'Show Sources'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Source Content: Batch Outputs */}
        {hasSources && showSourceOutputs && (
          <div className="source-content-section">
            <div className="sources-header" style={{ 
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: '1px solid #e1e5e9'
            }}>
              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#666' }}>Sources</h4>
            </div>
            <div className="sources-content">
              <ProviderResponseBlock
                providerResponses={allSources}
                isLoading={isLoading}
                currentAppStep={currentAppStep as AppStep}
                isReducedMotion={isReducedMotion}
              />
            </div>
          </div>
        )}

        {/* Composer Mode Entry Button */}
        {hasComposableContent(aiTurn) && (
          <div className="composer-entry" style={{ 
            textAlign: 'center',
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '1px solid #e1e5e9'
          }}>
            <button 
              onClick={() => onEnterComposerMode?.(aiTurn)}
              className="composer-button"
              style={{
                padding: '8px 16px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Open in Composer
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiTurnBlock;