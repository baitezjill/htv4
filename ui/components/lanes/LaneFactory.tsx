import React from 'react';
import { getProviderById } from '../../providers/providerRegistry';

interface LaneFactoryProps {
  providerIds: string[]; // which providers to render as main lanes, in order
  orientation?: 'row' | 'column';
  className?: string;
  style?: React.CSSProperties;
  // Render function for each lane (receives providerId)
  renderLane: (providerId: string) => React.ReactNode;
}

/**
 * LaneFactory
 * Renders lanes by looping the provider config instead of hard-coding components.
 * Keeps layout consistent with current look & feel.
 */
export const LaneFactory: React.FC<LaneFactoryProps> = ({ providerIds, orientation = 'row', className, style, renderLane }) => {
  if (!providerIds || providerIds.length === 0) return null;

  // Preserve current grid layout semantics
  const baseStyle: React.CSSProperties = orientation === 'row'
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginBottom: '16px' }
    : { display: 'flex', flexDirection: 'column', gap: '12px' };

  return (
    <div className={className} style={{ ...baseStyle, ...style }}>
      {providerIds.map(pid => {
        const p = getProviderById(pid);
        if (!p) return null;
        return (
          <React.Fragment key={pid}>
            {renderLane(pid)}
          </React.Fragment>
        );
      })}
    </div>
  );
};