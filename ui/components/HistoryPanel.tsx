// React import removed
import { ChatSession } from '../types'; // It only needs to know what a ChatSession looks like.

interface HistoryPanelProps {
  isOpen: boolean;
  sessions: ChatSession[];
  isLoading: boolean;
  onNewChat: () => void;
  onSelectChat: (session: ChatSession) => void; // It passes the whole session object up.
  onDeleteChat: (sessionId: string) => void; // Delete handler provided by parent
}

const HistoryPanel = ({ isOpen, sessions, isLoading, onNewChat, onSelectChat, onDeleteChat }: HistoryPanelProps) => {
  // NO useEffect, NO useState, NO api calls in this file.

  const panelStyle: any = {
    position: 'sticky',
    top: 0,
    width: isOpen ? '260px' : '0px',
    background: 'rgba(10, 10, 25, 0.9)',
    backdropFilter: 'blur(15px)',
    borderRight: isOpen ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
    color: '#e2e8f0',
    padding: isOpen ? '20px' : '0px',
    overflowY: 'auto',
    overflowX: 'hidden',
    transition: 'width 0.3s ease, padding 0.3s ease',
    zIndex: 5,
    display: 'flex',
    flexDirection: 'column',
  };

  // Added concrete styles for clear separation and accessibility
  const headerButtonStyle: any = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    background: 'linear-gradient(180deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))',
    color: '#e2e8f0',
    cursor: 'pointer',
    marginBottom: '12px',
  };

  const itemStyle: any = {
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.02)',
    color: '#e2e8f0',
    cursor: 'pointer',
    marginBottom: '8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  };

  const deleteBtnStyle: any = {
    flexShrink: 0,
    marginLeft: '8px',
    background: 'rgba(255, 0, 0, 0.12)',
    border: '1px solid rgba(255, 0, 0, 0.25)',
    color: '#fecaca',
    borderRadius: '6px',
    padding: '4px 6px',
    cursor: 'pointer',
    fontSize: '12px',
  };

  return (
    <div style={panelStyle}>
      {isOpen && (
        <>
          <button onClick={onNewChat} style={headerButtonStyle} title="Start a new chat">+ New Chat</button>
          <div className="history-items" style={{ flexGrow: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <p>Loading history...</p>
            ) : sessions.length === 0 ? (
              <p>No chat history yet.</p>
            ) : (
              sessions
                .filter(s => s && s.sessionId)
                .sort((a, b) => (b.lastActivity || b.startTime || 0) - (a.lastActivity || a.startTime || 0))
                .map((session: ChatSession) => (
                <div
                  key={session.id}
                  onClick={() => onSelectChat(session)} // Pass the whole, typed session object.
                  style={itemStyle}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectChat(session);
                    }
                  }}
                  title={session.title}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.title}</span>
                  <button
                    aria-label={`Delete chat ${session.title}`}
                    title="Delete chat"
                    style={deleteBtnStyle}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(session.sessionId);
                    }}
                  >
                    🗑️
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default HistoryPanel;