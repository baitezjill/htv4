import { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { ComposableSource, GranularUnit } from '../../types';
import { parseIntoGranularUnits } from '../../utils/composerUtils';
import { getProviderById } from '../../providers/providerRegistry';

interface SourcePanelProps {
  sources: ComposableSource[];
  granularity: 'full' | 'paragraph' | 'sentence';
}

interface DraggableContentItemProps {
  unit: GranularUnit;
  providerId: string;
  sourceType: string;
}

const DraggableContentItem = ({ unit, providerId, sourceType }: DraggableContentItemProps) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: unit.id,
    data: unit,
  });
  
  const provider = getProviderById(providerId);
  
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        padding: '12px',
        background: isDragging ? '#334155' : '#1e293b',
        border: '1px solid',
        borderColor: isDragging ? '#8b5cf6' : '#334155',
        borderRadius: '8px',
        cursor: 'grab',
        marginBottom: '8px',
        transition: 'all 0.2s ease',
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '8px',
          fontSize: '11px',
          color: '#94a3b8',
        }}
      >
        {provider && (
          <div
            className={`model-logo ${provider.logoBgClass}`}
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '3px',
            }}
          />
        )}
        <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>
          {provider?.name || providerId}
        </span>
        <span style={{ opacity: 0.6 }}>•</span>
        <span style={{ textTransform: 'capitalize', opacity: 0.8 }}>
          {sourceType}
        </span>
        {unit.type !== 'full' && (
          <>
            <span style={{ opacity: 0.6 }}>•</span>
            <span style={{ opacity: 0.8 }}>
              {unit.type} {unit.index + 1}
            </span>
          </>
        )}
      </div>
      
      <div
        style={{
          fontSize: '13px',
          lineHeight: '1.5',
          color: '#e2e8f0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: '200px',
          overflow: 'auto',
        }}
      >
        {unit.text}
      </div>
      
      <div
        style={{
          marginTop: '8px',
          padding: '4px 8px',
          background: '#0f172a',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#64748b',
          textAlign: 'center',
        }}
      >
        Drag to canvas →
      </div>
    </div>
  );
};

const SourcePanel = ({ sources, granularity }: SourcePanelProps) => {
  // Parse all sources into granular units based on current granularity
  const granularUnits = useMemo(() => {
    return sources.flatMap((source) =>
      parseIntoGranularUnits(source.content, granularity, source.id, source.providerId).map(
        (unit) => ({
          ...unit,
          sourceType: source.type,
        })
      )
    );
  }, [sources, granularity]);
  
  if (sources.length === 0) {
    return (
      <div
        style={{
          width: '400px',
          background: '#1e293b',
          borderRadius: '12px',
          padding: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '12px',
          border: '1px solid #334155',
        }}
      >
        <div style={{ fontSize: '48px' }}>📝</div>
        <div style={{ fontSize: '14px', color: '#94a3b8', textAlign: 'center' }}>
          No AI responses available for composition
        </div>
      </div>
    );
  }
  
  return (
    <div
      style={{
        width: '400px',
        background: '#1e293b',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #334155',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid #334155',
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0' }}>
          AI Outputs
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
          {sources.length} source{sources.length !== 1 ? 's' : ''} • {granularUnits.length}{' '}
          {granularity === 'full' ? 'response' : granularity}
          {granularUnits.length !== 1 ? 's' : ''}
        </div>
      </div>
      
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: '4px',
        }}
      >
        {granularUnits.map((unit) => (
          <DraggableContentItem
            key={unit.id}
            unit={unit}
            providerId={unit.providerId}
            sourceType={(unit as any).sourceType}
          />
        ))}
      </div>
    </div>
  );
};

export default SourcePanel;
