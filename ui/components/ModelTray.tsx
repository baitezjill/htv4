import { LLMProvider } from '../types';
import { LLM_PROVIDERS_CONFIG } from '../constants';

interface ModelTrayProps {
  selectedModels: Record<string, boolean>;
  onToggleModel: (providerId: string) => void;
  isLoading?: boolean;
  // Think-mode (global) toggle for ChatGPT
  thinkOnChatGPT?: boolean;
  onToggleThinkChatGPT?: () => void;
}

const ModelTray = ({ selectedModels, onToggleModel, isLoading = false, thinkOnChatGPT = false, onToggleThinkChatGPT }: ModelTrayProps) => {
  return (
    <div
      className="model-tray"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '12px 16px',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '12px 12px 0 0',
        borderBottom: 'none',
      }}
    >
      <span
        style={{
          fontSize: '12px',
          color: '#94a3b8',
          fontWeight: 500,
          marginRight: '8px',
        }}
      >
        Models:
      </span>
      
      {LLM_PROVIDERS_CONFIG.map((provider: LLMProvider) => {
        const isSelected = selectedModels[provider.id];
        return (
          <button
            key={provider.id}
            onClick={() => !isLoading && onToggleModel(provider.id)}
            disabled={isLoading}
            title={`${isSelected ? 'Deselect' : 'Select'} ${provider.name}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: isSelected 
                ? 'rgba(99, 102, 241, 0.2)' 
                : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${
                isSelected 
                  ? 'rgba(99, 102, 241, 0.4)' 
                  : 'rgba(255, 255, 255, 0.1)'
              }`,
              borderRadius: '8px',
              color: isSelected ? '#a5b4fc' : '#64748b',
              fontSize: '12px',
              fontWeight: 500,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              opacity: isLoading ? 0.6 : (isSelected ? 1 : 0.7),
              transform: 'scale(1)',
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.background = isSelected 
                  ? 'rgba(99, 102, 241, 0.3)' 
                  : 'rgba(255, 255, 255, 0.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isLoading) {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.background = isSelected 
                  ? 'rgba(99, 102, 241, 0.2)' 
                  : 'rgba(255, 255, 255, 0.05)';
              }
            }}
          >
            {/* Model Logo */}
            <div
              className={`model-logo ${provider.logoBgClass}`}
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '3px',
                opacity: isSelected ? 1 : 0.6,
              }}
            />
            
            {/* Model Name */}
            <span>{provider.name}</span>
            
            {/* Selection Indicator */}
            <span
              style={{
                fontSize: '10px',
                opacity: isSelected ? 1 : 0.4,
              }}
            >
              {isSelected ? '✓' : '○'}
            </span>
          </button>
        );
      })}
      {/* Global Think toggle for ChatGPT */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
        <button
          onClick={() => !isLoading && onToggleThinkChatGPT?.()}
          disabled={isLoading}
          title={`Think mode for ChatGPT ${thinkOnChatGPT ? 'ON' : 'OFF'}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            background: thinkOnChatGPT ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${thinkOnChatGPT ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
            borderRadius: '999px',
            color: thinkOnChatGPT ? '#a5b4fc' : '#64748b',
            fontSize: '12px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: '14px' }}>🤔</span>
          <span>Think (ChatGPT)</span>
          <span style={{ fontSize: '10px', opacity: thinkOnChatGPT ? 1 : 0.7 }}>{thinkOnChatGPT ? 'ON' : 'OFF'}</span>
        </button>
      </div>
      
      {/* Active Count Indicator */}
      <div
        style={{
          marginLeft: 'auto',
          fontSize: '11px',
          color: '#64748b',
          padding: '4px 8px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '6px',
        }}
      >
        {Object.values(selectedModels).filter(Boolean).length} selected
      </div>
    </div>
  );
};

export default ModelTray;