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

  // Read response data directly from the unified aiTurn object
  const batchResponses = useMemo(() => aiTurn.batchResponses || {}, [aiTurn.batchResponses]);
  // Normalize synthesis/ensemble maps to arrays per provider for multi-take support
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

  // Merge batch responses with hidden batch outputs for display
  const mergedBatchOutputs = useMemo(() => {
    const merged = { ...batchResponses };
    
    if (aiTurn.hiddenBatchOutputs) {
      Object.entries(aiTurn.hiddenBatchOutputs).forEach(([providerId, text]) => {
        if (!merged[providerId]) {
          merged[providerId] = {
            providerId,
            text: typeof text === 'string' ? text : text?.text || '',
            status: 'completed' as const,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
        }
      });
    }
    
    return merged;
  }, [batchResponses, aiTurn.hiddenBatchOutputs]);

  // Determine what sections to show based on available data
  const shouldShowBatchResponses = Object.keys(mergedBatchOutputs).length > 0;
  const shouldShowSynthesisResponses = Object.keys(synthesisResponses).length > 0;
  const shouldShowEnsembleResponses = Object.keys(ensembleResponses).length > 0;

  // Determine header text based on available responses
  const getHeaderText = () => {
    if (shouldShowEnsembleResponses) return "Ensemble Answer";
    if (shouldShowSynthesisResponses) return "Synthesis";
    return "AI Response";
  };

  return (
    <div className="ai-turn-block">
      {/* Header */}
      <div className="ai-turn-header">
        <h3>{getHeaderText()}</h3>
      </div>

      {/* Flexible Layout Container */}
      <div className="ai-turn-content">
        {/* Top Row: Synthesis and Ensemble side-by-side */}
        {(shouldShowSynthesisResponses || shouldShowEnsembleResponses) && (
          <div className="synthesis-ensemble-row" style={{ 
            display: 'flex', 
            gap: '16px', 
            marginBottom: shouldShowBatchResponses ? '24px' : '0'
          }}>
            {/* Synthesis Section */}
            {shouldShowSynthesisResponses && (
              <div className="synthesis-section" style={{ flex: 1 }}>
                <div className="section-header">
                  <h4>Synthesis</h4>
                  <button 
                    onClick={() => setShowSynthesisCollapse(!showSynthesisCollapse)}
                    className="collapse-button"
                  >
                    {showSynthesisCollapse ? '▼' : '▶'}
                  </button>
                </div>
                {!showSynthesisCollapse && (
                  <div className="synthesis-content">
                    {Object.entries(synthesisResponses).flatMap(([pid, responses]) => (
                      responses.map((response, index) => (
                        <div key={`synthesis-${pid}-${index}`} className="provider-response">
                          <div className="provider-header">
                            <span className="provider-name">{response.providerId || pid}</span>
                            <span className="provider-status">{response.status}</span>
                          </div>
                          <div className="response-text">{response.text}</div>
                        </div>
                      ))
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Ensemble Section */}
            {shouldShowEnsembleResponses && (
              <div className="ensemble-section" style={{ flex: 1 }}>
                <div className="section-header">
                  <h4>Ensemble</h4>
                </div>
                <div className="ensemble-content">
                  {Object.entries(ensembleResponses).flatMap(([pid, responses]) => (
                    responses.map((response, index) => (
                      <div key={`ensemble-${pid}-${index}`} className="provider-response">
                        <div className="provider-header">
                          <span className="provider-name">{response.providerId || pid}</span>
                          <span className="provider-status">{response.status}</span>
                        </div>
                        <div className="response-text">{response.text}</div>
                      </div>
                    ))
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom Section: Batch Outputs (Sources) */}
        {shouldShowBatchResponses && (
          <div className="batch-section">
            <div className="section-header">
              <h4>Sources</h4>
              <button 
                onClick={() => onToggleSourceOutputs?.()}
                className="toggle-button"
              >
                {showSourceOutputs ? 'Hide Sources' : 'Show Sources'}
              </button>
            </div>
            {showSourceOutputs && (
              <div className="batch-content">
                <ProviderResponseBlock
                  providerResponses={mergedBatchOutputs}
                  isLoading={isLoading}
                  currentAppStep={currentAppStep as AppStep}
                  isReducedMotion={isReducedMotion}
                />
              </div>
            )}
          </div>
        )}

        {/* Composer Mode Entry Button */}
        <div className="composer-entry">
          <button 
            onClick={() => onEnterComposerMode?.(aiTurn)}
            className="composer-button"
          >
            Open in Composer
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiTurnBlock;