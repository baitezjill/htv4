import { AiTurn, ProviderResponse, AppStep } from '../types';
import { BotIcon } from './Icons';
import ProviderResponseBlock from './ProviderResponseBlock';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProviderPill } from './ProviderPill';

interface AiTurnBlockProps {
  aiTurn: AiTurn;
  isLive?: boolean;
  isReducedMotion?: boolean;
  currentAppStep?: AppStep;
}

const AiTurnBlock = ({ aiTurn, isLive = false, isReducedMotion = false, currentAppStep }: AiTurnBlockProps) => {
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

      {/* Provider Responses Grid - Show First */}
      {Object.keys(aiTurn.providerResponses).length > 0 && (
        <ProviderResponseBlock
          providerResponses={aiTurn.providerResponses}
          isLoading={isLive}
          currentAppStep={currentAppStep || (isLive ? 'awaitingSynthesis' : 'synthesisDone')}
          isReducedMotion={isReducedMotion}
        />
      )}

      {/* Round-level action bar is rendered under UserTurnBlock now */}

      {/* Synthesis Response - Only show inside turn when finalized, to avoid duplication with sticky overlay */}
      {aiTurn.synthesisResponse && (
        (!isLive || currentAppStep === 'synthesis' || currentAppStep === 'synthesisDone')
      ) && (
        <div
          className="synthesis-section"
          style={{
            marginTop: '16px',
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
            Synthesis
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
          <ProviderPill id={Object.keys(aiTurn.providerResponses)[0] as any} />
        </div>
      )}

      {/* Hidden perspectives panel removed */}
    </div>
  );
};

export default AiTurnBlock;