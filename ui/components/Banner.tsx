import React from 'react';

interface BannerProps {
  text: string;
  onClose: () => void;
  onOpen?: () => void;
}

const Banner: React.FC<BannerProps> = ({ text, onClose, onOpen }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 2000,
        background: 'rgba(15, 23, 42, 0.95)',
        color: '#e2e8f0',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        padding: '10px 12px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        maxWidth: 360,
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1.4 }}>{text}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {onOpen && (
          <button
            onClick={onOpen}
            style={{
              background: '#334155',
              color: '#cbd5e1',
              border: '1px solid #475569',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Open
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close notice"
          style={{
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default Banner;
