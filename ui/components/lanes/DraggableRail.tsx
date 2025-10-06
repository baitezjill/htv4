import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { tokens } from '../../theme/tokens';
import { getProviderById } from '../../providers/providerRegistry';
import { RailCardState } from './Rail';

interface DraggableRailCardProps {
  providerId: string;
  state: RailCardState;
  getPreviewContent?: (providerId: string) => { text: string; lastAiTurn: string } | null;
}

const DraggableRailCard: React.FC<DraggableRailCardProps> = ({ 
  providerId, 
  state,
  getPreviewContent 
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: providerId,
    data: { type: 'rail-provider', providerId }
  });

  const provider = getProviderById(providerId);
  if (!provider) return null;

  const Icon = provider.icon;
  const previewContent = showPreview && getPreviewContent ? getPreviewContent(providerId) : null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        title={provider.name}
        aria-label={`Drag ${provider.name} to swap into view`}
        onMouseEnter={() => setShowPreview(true)}
        onMouseLeave={() => setShowPreview(false)}
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: tokens.rail.cardBg,
          border: `1px solid ${tokens.rail.border}`,
          boxShadow: tokens.rail.cardShadow,
          cursor: isDragging ? 'grabbing' : 'grab',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 150ms ease, transform 150ms ease',
          opacity: isDragging ? 0.5 : 1,
          transform: isDragging ? 'scale(1.1)' : 'scale(1)',
        }}
      >
        {Icon ? (
          <Icon size={16} />
        ) : (
          <div style={{ width: 16, height: 16, borderRadius: 4, background: provider.color }} />
        )}

        {/* Status dot */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 2,
            bottom: 2,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: state.error
              ? tokens.status.error
              : state.streaming
                ? tokens.status.streaming
                : state.unread
                  ? tokens.status.unread
                  : 'transparent',
            boxShadow: state.streaming ? '0 0 0 2px rgba(16,185,129,0.2)' : undefined,
            animation: state.streaming ? 'pulse 1.2s ease-in-out infinite' : undefined,
          }}
        />
      </button>

      {/* Hover Preview - Expanded card on hover */}
      {showPreview && previewContent && (
        <div
          style={{
            position: 'absolute',
            left: 40,
            top: 0,
            width: 280,
            maxHeight: 200,
            background: 'rgba(30, 41, 59, 0.98)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 1000,
            pointerEvents: 'none',
            backdropFilter: 'blur(10px)',
          }}
        >
          {/* Provider header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {Icon && <Icon size={16} />}
            <span style={{ fontSize: 12, fontWeight: 600, color: '#a5b4fc' }}>
              {provider.name}
            </span>
          </div>

          {/* Preview text */}
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.4,
              color: '#e2e8f0',
              maxHeight: 140,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 6,
              WebkitBoxOrient: 'vertical',
              textOverflow: 'ellipsis',
            }}
          >
            {previewContent.text || previewContent.lastAiTurn || 'No content yet...'}
          </div>

          {/* Drag hint */}
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              fontSize: 10,
              color: '#64748b',
              fontStyle: 'italic',
            }}
          >
            ← Drag to swap into main view
          </div>
        </div>
      )}
    </div>
  );
};

interface DraggableRailProps {
  providerIds: string[];
  position?: 'left' | 'right';
  collapsedWidth?: number;
  expandedWidth?: number;
  getStateFor?: (providerId: string) => RailCardState;
  getPreviewContent?: (providerId: string) => { text: string; lastAiTurn: string } | null;
}

export const DraggableRail: React.FC<DraggableRailProps> = ({
  providerIds,
  position = 'left',
  collapsedWidth = 4,
  expandedWidth = 40,
  getStateFor,
  getPreviewContent,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!providerIds || providerIds.length === 0) return null;

  const isLeft = position === 'left';
  const sideStyleKey = isLeft ? 'left' : 'right';

  return (
    <div
      aria-label="Additional providers (drag to swap)"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [sideStyleKey]: 0,
        width: isExpanded ? expandedWidth : collapsedWidth,
        background: tokens.rail.bg,
        borderRight: isLeft ? `1px solid ${tokens.rail.border}` : undefined,
        borderLeft: !isLeft ? `1px solid ${tokens.rail.border}` : undefined,
        transition: 'width 150ms ease',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      } as React.CSSProperties}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: 6,
        }}
      >
        {providerIds.map((pid) => {
          const state = getStateFor?.(pid) || {};
          return (
            <DraggableRailCard
              key={pid}
              providerId={pid}
              state={state}
              getPreviewContent={getPreviewContent}
            />
          );
        })}
      </div>
    </div>
  );
};
