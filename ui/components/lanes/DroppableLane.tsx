import React from 'react';
import { useDroppable } from '@dnd-kit/core';

interface DroppableLaneProps {
  laneId: string;
  isOver?: boolean;
  children: React.ReactNode;
}

export const DroppableLane: React.FC<DroppableLaneProps> = ({ laneId, children }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: laneId,
    data: { type: 'provider-lane', laneId }
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'relative',
        transition: 'all 0.2s ease',
        ...(isOver && {
          outline: '2px solid rgba(99, 102, 241, 0.6)',
          outlineOffset: '4px',
          borderRadius: '12px',
        })
      }}
    >
      {children}
      
      {/* Drop indicator overlay */}
      {isOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(99, 102, 241, 0.1)',
            borderRadius: '12px',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            style={{
              padding: '8px 16px',
              background: 'rgba(99, 102, 241, 0.9)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '12px',
              fontWeight: 600,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            }}
          >
            Drop to swap
          </div>
        </div>
      )}
    </div>
  );
};
