import { LLMProvider, AppStep, ProviderResponse } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';
import { BotIcon, ChevronDownIcon, ChevronUpIcon } from './Icons';
import { LaneFactory } from './lanes/LaneFactory';
import { Rail } from './lanes/Rail';
import { useLaneRailState } from './lanes/useLaneRailState';
import { getProviderById } from '../providers/providerRegistry';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ProviderPill } from './ProviderPill';

// Legacy interface for backward compatibility
interface ProviderState {
  text: string;
  status: 'pending' | 'streaming' | 'completed' | 'error';
}

type ProviderStates = Record<string, ProviderState>;

interface ProviderResponseBlockProps {
  // Updated to accept ProviderResponse objects directly
  providerResponses?: Record<string, ProviderResponse>;
  // Legacy prop for backward compatibility
  providerStates?: ProviderStates;
  isLoading: boolean;
  currentAppStep: AppStep;
  isReducedMotion?: boolean;
}

const CopyButton = ({ text, label, onClick }: { text: string; label: string; onClick?: () => void }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onClick?.();
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  }, [text, onClick]);

  return (
    <button
      onClick={handleCopy}
      aria-label={label}
      className="copy-button"
      style={{
        background: '#334155',
        border: '1px solid #475569',
        borderRadius: '6px',
        padding: '4px 8px',
        color: '#94a3b8',
        fontSize: '12px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      {copied ? '✓' : '📋'} {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const ProviderResponseBlock = ({ 
  providerResponses,
  providerStates, 
  isLoading, 
  currentAppStep,
  isReducedMotion = false
}: ProviderResponseBlockProps) => {
  // Keep both shapes: full responses (including meta) when available, and a legacy states map
  const effectiveProviderResponses = providerResponses 
    ? { ...providerResponses }
    : // Normalize legacy providerStates into a minimal ProviderResponse-like shape
    Object.fromEntries(
      Object.entries(providerStates || {}).map(([id, s]) => [
        id,
        { text: s.text, status: s.status, meta: undefined },
      ])
    );

  const effectiveProviderStates = Object.entries(effectiveProviderResponses).reduce((acc, [providerId, response]) => {
    acc[providerId] = {
      text: (response as any).text,
      status: (response as any).status,
    };
    return acc;
  }, {} as ProviderStates);

  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [blockMinHeight, setBlockMinHeight] = useState<string>('calc(100vh / 6)');

  // Calculate min-height for responsive block sizing (~1/6 viewport)
  useEffect(() => {
    const updateMinHeight = () => {
      const viewportHeight = window.innerHeight;
      const chatAreaHeight = viewportHeight * 0.6; // Approximate available chat area
      setBlockMinHeight(`${Math.max(120, chatAreaHeight / 6)}px`);
    };

    updateMinHeight();
    window.addEventListener('resize', updateMinHeight);
    return () => window.removeEventListener('resize', updateMinHeight);
  }, []);

  // Auto-expand logic for content > 2 lines - keep expanded after streaming completes
  useEffect(() => {
    Object.entries(effectiveProviderStates).forEach(([providerId, state]) => {
      if (state.text) {
        // Estimate line count (rough approximation)
        const lineCount = Math.ceil(state.text.length / 60); // ~60 chars per line
        if (lineCount > 2 && !expandedProviders[providerId]) {
          setExpandedProviders(prev => ({ ...prev, [providerId]: true }));
        }
      }
    });
  }, [effectiveProviderStates, expandedProviders]);

  const getProviderConfig = (providerId: string): LLMProvider | undefined => {
    return LLM_PROVIDERS_CONFIG.find(p => p.id === providerId);
  };

  const toggleExpanded = (providerId: string) => {
    setExpandedProviders(prev => ({
      ...prev,
      [providerId]: !prev[providerId]
    }));
  };

  const handleExpandAll = () => {
    const allProviders = Object.keys(filteredProviderStates);
    const allExpanded = allProviders.reduce((acc, id) => ({ ...acc, [id]: true }), {} as Record<string, boolean>);
    setExpandedProviders(allExpanded);
  };

  const handleCollapseAll = () => {
    setExpandedProviders({});
  };

  const handleCopyAll = () => {
    const allText = Object.entries(filteredProviderStates)
      .filter(([_, state]) => state.text)
      .map(([providerId, state]) => {
        const provider = getProviderConfig(providerId);
        return `${provider?.name || providerId}:\n${state.text}`;
      })
      .join('\n\n---\n\n');

    navigator.clipboard.writeText(allText);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'streaming': return '#f59e0b';
      case 'completed': return '#10b981';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Waiting...';
      case 'streaming': return 'Generating...';
      case 'completed': return 'Complete';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  };

  // Filter out system provider for main UI display
  const filteredProviderStates = Object.fromEntries(
    Object.entries(effectiveProviderStates).filter(([providerId]) => providerId !== 'system')
  );

  if (Object.keys(filteredProviderStates).length === 0) {
    return null;
  }

  return (
    <div className="response-container" style={{ marginBottom: '24px', display: 'flex' }}>
      <BotIcon style={{
          width: '32px', height: '32px', color: '#a78bfa', marginRight: '12px', flexShrink: 0, marginTop:'4px'
      }} />
      <div style={{flexGrow: 1}}>
        {/* Global Controls Header */}
        <div className="global-controls" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
          padding: '8px 12px',
          background: '#1e293b',
          borderRadius: '8px',
          border: '1px solid #334155'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: '#94a3b8' }}>
            AI Responses ({Object.keys(filteredProviderStates).length})
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleExpandAll}
              style={{
                background: '#334155',
                border: '1px solid #475569',
                borderRadius: '6px',
                padding: '4px 8px',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Expand All
            </button>
            <button
              onClick={handleCollapseAll}
              style={{
                background: '#334155',
                border: '1px solid #475569',
                borderRadius: '6px',
                padding: '4px 8px',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Collapse All
            </button>
            <CopyButton 
              text={Object.entries(filteredProviderStates).map(([id, state]) => 
                `${getProviderConfig(id)?.name || id}:\n${state.text}`
              ).join('\n\n---\n\n')} 
              label="Copy all provider responses"
            />
          </div>
        </div>

        {/* Provider Blocks Grid with 3 + rail behavior */}
        {(() => {
          const presentProviderIds = Object.keys(filteredProviderStates);
          // Order by global config order for stable UX
          const orderedIds = LLM_PROVIDERS_CONFIG
            .map(p => p.id)
            .filter(id => presentProviderIds.includes(id));

          const count = orderedIds.length;
          if (count <= 3) {
            // Preserve today's look & feel exactly
            return (
              <div className="providers-layer" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '12px',
                marginBottom: '16px',
                position: 'relative'
              }}>
                {orderedIds.map((providerId) => {
                  const state = (effectiveProviderStates as any)[providerId];
                  const provider = getProviderConfig(providerId);
                  const isExpanded = expandedProviders[providerId];
                  const isStreaming = state?.status === 'streaming';
                  const transitionStyle = isReducedMotion ? {} : { transition: 'max-height 0.3s ease, background 0.2s ease' };

                  return (
                    <div key={providerId} className={`provider-block ${isExpanded ? 'expanded' : ''}`}
                      style={{
                        position: 'relative',
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '12px',
                        padding: '16px',
                        minHeight: blockMinHeight,
                        display: 'flex',
                        flexDirection: 'column',
                        ...transitionStyle,
                        ...(isExpanded && { background: '#293548' })
                      }}
                      aria-live="polite"
                    >
                      {/* Provider Header */}
                      <div className="provider-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexShrink: 0 }}>
                        {provider && (
                          <div className={`model-logo ${provider.logoBgClass}`} style={{ width: '16px', height: '16px', borderRadius: '3px' }} />
                        )}
                        <div className="model-name" style={{ fontWeight: 500, fontSize: '12px', color: '#94a3b8' }}>
                          {provider?.name || providerId}
                        </div>
                        <div className="status-indicator" style={{ marginLeft: 'auto', width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(state?.status), ...(isStreaming && { animation: 'pulse 1.5s ease-in-out infinite' }) }} />
                      </div>

                      {/* Per-Provider Controls */}
                      <div className="provider-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexShrink: 0 }}>
                        <button
                          onClick={() => toggleExpanded(providerId)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${provider?.name || providerId} response`}
                          style={{
                            background: '#334155', border: '1px solid #475569', borderRadius: '6px', padding: '4px 8px', color: '#94a3b8', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                          }}
                        >
                          {isExpanded ? <ChevronUpIcon style={{ width: '12px', height: '12px' }} /> : <ChevronDownIcon style={{ width: '12px', height: '12px' }} />}
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                      </div>

                      {/* Content Area */}
                      <div className="provider-content" style={{ flex: 1, cursor: isExpanded ? 'default' : 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={!isExpanded ? () => toggleExpanded(providerId) : undefined}>
                        {/* Collapsed Gist */}
                        {!isExpanded && (
                          <div style={{ fontSize: '13px', lineHeight: '1.5', color: '#e2e8f0', whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis', height: 'calc(1.5em * 2)' }}>
                            {state?.text || getStatusText(state?.status)}
                            {isStreaming && !state?.text && <span className="streaming-dots" />}
                          </div>
                        )}
                        {/* Expanded Full */}
                        {isExpanded && (
                          <div data-provider-chat style={{ fontSize: '13px', lineHeight: '1.5', color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: '60vh', overflowY: 'auto', padding: '12px', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px', flex: 1 }}>
                            {state?.text || getStatusText(state?.status)}
                            {isStreaming && <span className="streaming-dots" />}
                          </div>
                        )}
                        {/* Footer */}
                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <CopyButton text={state?.text} label={`Copy ${provider?.name || providerId} response`} />
                          <ProviderPill id={providerId as any} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }

          // 3 + Rail case
          const { mainIds, railIds, swapInFromRail } = useLaneRailState(orderedIds, 3);
          const position: 'left' | 'right' = 'left'; // default to left as requested

          const renderProviderCard = (providerId: string) => {
            const state = (effectiveProviderStates as any)[providerId];
            const provider = getProviderConfig(providerId);
            const isExpanded = !!expandedProviders[providerId];
            const isStreaming = state?.status === 'streaming';
            const transitionStyle = isReducedMotion ? {} : { transition: 'max-height 0.3s ease, background 0.2s ease' };
            return (
              <div key={providerId} className={`provider-block ${isExpanded ? 'expanded' : ''}`}
                style={{ position: 'relative', background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '16px', minHeight: blockMinHeight, display: 'flex', flexDirection: 'column', ...transitionStyle, ...(isExpanded && { background: '#293548' }) }}
                aria-live="polite"
              >
                <div className="provider-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexShrink: 0 }}>
                  {provider && (<div className={`model-logo ${provider.logoBgClass}`} style={{ width: '16px', height: '16px', borderRadius: '3px' }} />)}
                  <div className="model-name" style={{ fontWeight: 500, fontSize: '12px', color: '#94a3b8' }}>{provider?.name || providerId}</div>
                  <div className="status-indicator" style={{ marginLeft: 'auto', width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(state?.status), ...(isStreaming && { animation: 'pulse 1.5s ease-in-out infinite' }) }} />
                </div>
                <div className="provider-controls" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexShrink: 0 }}>
                  <button onClick={() => toggleExpanded(providerId)} aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${provider?.name || providerId} response`} style={{ background: '#334155', border: '1px solid #475569', borderRadius: '6px', padding: '4px 8px', color: '#94a3b8', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isExpanded ? <ChevronUpIcon style={{ width: '12px', height: '12px' }} /> : <ChevronDownIcon style={{ width: '12px', height: '12px' }} />}
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                <div className="provider-content" style={{ flex: 1, cursor: isExpanded ? 'default' : 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={!isExpanded ? () => toggleExpanded(providerId) : undefined}>
                  {!isExpanded && (
                    <div style={{ fontSize: '13px', lineHeight: '1.5', color: '#e2e8f0', whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis', height: 'calc(1.5em * 2)' }}>
                      {state?.text || getStatusText(state?.status)}
                      {isStreaming && !state?.text && <span className="streaming-dots" />}
                    </div>
                  )}
                  {isExpanded && (
                    <div data-provider-chat style={{ fontSize: '13px', lineHeight: '1.5', color: '#e2e8f0', whiteSpace: 'pre-wrap', maxHeight: '60vh', overflowY: 'auto', padding: '12px', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px', flex: 1 }}>
                      {state?.text || getStatusText(state?.status)}
                      {isStreaming && <span className="streaming-dots" />}
                    </div>
                  )}
                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <CopyButton text={state?.text} label={`Copy ${provider?.name || providerId} response`} />
                    <ProviderPill id={providerId as any} />
                  </div>
                </div>
              </div>
            );
          };

          return (
            <div style={{ position: 'relative' }}>
              {/* Rail overlay */}
              <Rail
                providerIds={railIds}
                position={position}
                getStateFor={(pid) => {
                  const s = (effectiveProviderStates as any)[pid];
                  return {
                    streaming: s?.status === 'streaming',
                    unread: s?.status === 'completed',
                    error: s?.status === 'error'
                  };
                }}
                onCardClick={(pid) => swapInFromRail(pid)}
              />

              {/* Main lanes */}
              <LaneFactory
                providerIds={mainIds}
                renderLane={renderProviderCard}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default ProviderResponseBlock;