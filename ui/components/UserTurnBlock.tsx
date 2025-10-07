import { UserTurn } from '../types';
import { UserIcon, ChevronDownIcon, ChevronUpIcon } from './Icons';
import { useState, useCallback } from 'react';


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

interface UserTurnBlockProps {
  userTurn: UserTurn;
  isExpanded: boolean;
  onToggle: (turnId: string) => void;
  // Note: All props related to the action bar have been removed.
  // The UserTurnBlock is now a pure display component for the prompt.
}

const UserTurnBlock = ({ userTurn, isExpanded, onToggle }: UserTurnBlockProps) => {
  // ...

  const date = new Date(userTurn.createdAt);
  const readableTimestamp = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const isoTimestamp = date.toISOString();

  return (
    <div
      className="user-turn-block"
      style={{
        display: 'flex',
        gap: '12px',
        padding: '12px 16px',
        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
        border: '1px solid #475569',
        borderRadius: '1rem',
      }}
    >
      <div
        className="user-avatar"
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          background: 'rgba(99, 102, 241, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <UserIcon style={{ width: '18px', height: '18px', color: '#6366f1' }} />
      </div>
      <div className="user-content" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'visible', minHeight: '80px' }}>
        <div 
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: isExpanded ? '8px' : '0px' }}
          onClick={() => onToggle(userTurn.id)}
        >
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>Your Prompt</span>
          {isExpanded ? (
            <ChevronUpIcon style={{ width: '16px', height: '16px', color: '#cbd5e1' }} />
          ) : (
            <ChevronDownIcon style={{ width: '16px', height: '16px', color: '#cbd5e1' }} />
          )}
        </div>

        {isExpanded ? (
          <>
            <div
              className="user-message"
              style={{
                fontSize: '14px',
                lineHeight: '1.5',
                color: '#f1f5f9',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                marginBottom: '8px',
              }}
            >
              {userTurn.text}
            </div>
            <div
              className="user-metadata"
              style={{
                display: 'flex',
                gap: '12px',
                fontSize: '11px',
                color: '#94a3b8',
              }}
            >
              <span className="timestamp" title={isoTimestamp} aria-label={`Sent at ${readableTimestamp}`}>
                {readableTimestamp}
              </span>
              {userTurn.sessionId && (
                <span className="session-id" title={userTurn.sessionId}>
                  Session: {userTurn.sessionId.slice(-6)}
                </span>
              )}
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
              <CopyButton 
                text={userTurn.text} 
                label="Copy user prompt" 
              />
            </div>
          </>
        ) : (
            <div 
              className="user-message-preview" 
              style={{
                fontSize: '14px', 
                color: '#cbd5e1', 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis',
                paddingTop: '4px',
                marginBottom: '4px'
              }}
              title={userTurn.text}
            >
              {userTurn.text.replace(/\n/g, ' ')}
            </div>
        )}
        
      </div>
    </div>
  );
};

export default UserTurnBlock;
