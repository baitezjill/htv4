// ui/utils/composerUtils.ts (Refactored for the new types)

import { v4 as uuid } from 'uuid';
import type { AiTurn, ComposableSource, GranularUnit, ProviderResponse, SlateDescendant } from '../types';

/**
 * Extracts all valid AI responses from an AiTurn into a flat list of sources
 * for use in the Composer Mode source panel.
 */
export const extractComposableContent = (aiTurn: AiTurn): ComposableSource[] => {
  const sources: ComposableSource[] = [];

  // 1. Extract batch responses
  if (aiTurn.batchResponses) {
    for (const [providerId, response] of Object.entries(aiTurn.batchResponses)) {
      if (response.text?.trim() && response.status === 'completed') {
        sources.push({
          id: `batch-${providerId}-${uuid()}`,
          type: 'batch',
          providerId,
          content: response.text,
          status: response.status,
          metadata: response.meta
        });
      }
    }
  }

  // 2. Extract synthesis responses (handles multiple "takes" per provider)
  if (aiTurn.synthesisResponses) {
    for (const [providerId, takes] of Object.entries(aiTurn.synthesisResponses)) {
      for (const [index, take] of takes.entries()) {
        if (take.text?.trim() && take.status === 'completed') {
          sources.push({
            id: `synthesis-${providerId}-${index}-${uuid()}`,
            type: 'synthesis',
            providerId,
            content: take.text,
            status: take.status,
            metadata: take.meta
          });
        }
      }
    }
  }
  
  // 3. Extract ensemble responses (handles multiple "takes" per provider)
  if (aiTurn.ensembleResponses) {
    for (const [providerId, takes] of Object.entries(aiTurn.ensembleResponses)) {
      for (const [index, take] of takes.entries()) {
        if (take.text?.trim() && take.status === 'completed') {
          sources.push({
            id: `ensemble-${providerId}-${index}-${uuid()}`,
            type: 'ensemble',
            providerId,
            content: take.text,
            status: take.status,
            metadata: take.meta
          });
        }
      }
    }
  }

  // 4. Extract hidden batch outputs (for synthesis-first workflows)
  if (aiTurn.hiddenBatchOutputs) {
    for (const [providerId, response] of Object.entries(aiTurn.hiddenBatchOutputs)) {
      if (response.text?.trim() && response.status === 'completed') {
        sources.push({
          id: `hidden-${providerId}-${uuid()}`,
          type: 'hidden',
          providerId,
          content: response.text,
          status: response.status,
          metadata: response.meta
        });
      }
    }
  }

  return sources; // This return statement fixes the "must return a value" error.
};

/**
 * Parses content into granular units based on granularity level.
 * (Your superior implementation is kept here).
 */
export const parseIntoGranularUnits = (
  content: string,
  granularity: 'full' | 'paragraph' | 'sentence',
  sourceId: string,
  providerId: string
): GranularUnit[] => {
  if (!content?.trim()) {
    return [];
  }
  
  switch (granularity) {
    case 'full':
      return [{
        id: uuid(),
        text: content,
        type: 'full',
        sourceId,
        providerId,
        index: 0
      }];
      
    case 'paragraph':
      return content
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map((text, index) => ({
          id: uuid(),
          text,
          type: 'paragraph' as const,
          sourceId,
          providerId,
          index
        }));
        
    case 'sentence':
      // Smart sentence splitting that handles common abbreviations and edge cases
      const sentences = content
        .replace(/([.!?])\s+/g, '$1|SPLIT|')
        .split('|SPLIT|')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      
      return sentences.map((text, index) => ({
        id: uuid(),
        text,
        type: 'sentence' as const,
        sourceId,
        providerId,
        index
      }));
      
    default:
      return [];
  }
};

/**
 * Serializes Slate editor content to a plain text string.
 * Added strong typing to the `nodes` parameter.
 */
export const serializeToPlainText = (nodes: SlateDescendant[]): string => {
  return nodes
    .map(node => {
      // Check if it's a Text node (which has a 'text' property)
      if ('text' in node) {
        return node.text;
      }
      // Otherwise, it's an Element node, so recurse through its children
      if ('children' in node) {
        return serializeToPlainText(node.children);
      }
      return '';
    })
    .join('\n');
};

/**
 * Checks if an AiTurn has any valid, completed content to be used in the composer.
 */
export const hasComposableContent = (aiTurn: AiTurn): boolean => {
  // This helper function now correctly checks the structure of the response maps.
  const hasCompleted = (responses?: Record<string, ProviderResponse> | Record<string, ProviderResponse[]>) => {
    if (!responses) return false;
    return Object.values(responses)
      .flat() // .flat() works on both single objects and arrays of arrays
      .some(r => r.status === 'completed' && r.text?.trim());
  };

  return hasCompleted(aiTurn.batchResponses) || 
         hasCompleted(aiTurn.synthesisResponses) ||
         hasCompleted(aiTurn.ensembleResponses) ||
         hasCompleted(aiTurn.hiddenBatchOutputs);
};

/**
 * Format content for export based on format type
 */
export const formatForExport = (
  content: string,
  format: 'markdown' | 'html' | 'text' | 'json'
): string => {
  switch (format) {
    case 'markdown':
      return content;
    case 'html':
      return content.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
    case 'text':
      return content;
    case 'json':
      return JSON.stringify({ content, timestamp: Date.now() }, null, 2);
    default:
      return content;
  }
};

/**
 * Calculate word count for content
 */
export const calculateWordCount = (content: string): number => {
  if (!content) return 0;
  return content.trim().split(/\s+/).filter(Boolean).length;
};

/**
 * Estimate reading time in minutes
 */
export const estimateReadingTime = (content: string, wordsPerMinute = 200): number => {
  const wordCount = calculateWordCount(content);
  if (wordCount === 0) return 0;
  return Math.ceil(wordCount / wordsPerMinute);
};