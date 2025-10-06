interface ComposerToolbarProps {
  granularity: 'full' | 'paragraph' | 'sentence';
  onGranularityChange: (level: 'full' | 'paragraph' | 'sentence') => void;
  onExit: () => void;
  onSave: () => void;
  onExport: () => void;
  isDirty: boolean;
}

const ComposerToolbar = ({
  granularity,
  onGranularityChange,
  onExit,
  onSave,
  onExport,
  isDirty,
}: ComposerToolbarProps) => {
  return (
    <div
      className="composer-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        gap: '16px',
      }}
    >
      {/* Left section - Exit and title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onExit}
          style={{
            background: '#334155',
            border: '1px solid #475569',
            borderRadius: '8px',
            padding: '8px 16px',
            color: '#e2e8f0',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          aria-label="Exit Composer Mode"
        >
          <span style={{ fontSize: '16px' }}>←</span>
          Back to Chat
        </button>
        
        <div style={{ fontSize: '18px', fontWeight: 600, color: '#e2e8f0' }}>
          Composer Mode
        </div>
        
        {isDirty && (
          <span
            style={{
              fontSize: '12px',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '16px' }}>●</span>
            Unsaved changes
          </span>
        )}
      </div>
      
      {/* Center section - Granularity controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#0f172a',
          borderRadius: '8px',
          padding: '4px',
          border: '1px solid #334155',
        }}
      >
        <span
          style={{
            fontSize: '12px',
            color: '#94a3b8',
            paddingLeft: '8px',
            fontWeight: 500,
          }}
        >
          Granularity:
        </span>
        
        {(['full', 'paragraph', 'sentence'] as const).map((level) => (
          <button
            key={level}
            onClick={() => onGranularityChange(level)}
            style={{
              background: granularity === level ? '#8b5cf6' : 'transparent',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 12px',
              color: granularity === level ? '#fff' : '#94a3b8',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              textTransform: 'capitalize',
            }}
            aria-pressed={granularity === level}
          >
            {level}
          </button>
        ))}
      </div>
      
      {/* Right section - Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={onSave}
          disabled={!isDirty}
          style={{
            background: isDirty ? '#10b981' : '#334155',
            border: '1px solid',
            borderColor: isDirty ? '#10b981' : '#475569',
            borderRadius: '8px',
            padding: '8px 16px',
            color: isDirty ? '#fff' : '#64748b',
            fontSize: '14px',
            fontWeight: 500,
            cursor: isDirty ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: isDirty ? 1 : 0.6,
          }}
          aria-label="Save composition"
        >
          <span style={{ fontSize: '16px' }}>💾</span>
          Save
        </button>
        
        <button
          onClick={onExport}
          style={{
            background: '#8b5cf6',
            border: '1px solid #8b5cf6',
            borderRadius: '8px',
            padding: '8px 16px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          aria-label="Copy to clipboard"
        >
          <span style={{ fontSize: '16px' }}>📋</span>
          Copy
        </button>
      </div>
    </div>
  );
};

export default ComposerToolbar;
