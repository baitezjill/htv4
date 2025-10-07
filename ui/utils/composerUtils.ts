import { v4 as uuid } from 'uuid';
import type { AiTurn, ComposableSource, GranularUnit, ProviderResponse } from '../types';

/**
 * Extract all available AI responses from an AiTurn for composition
 */
export const extractComposableContent = (aiTurn: AiTurn): ComposableSource[] => {
  const sources: ComposableSource[] = [];
  
  // Extract batch responses (GPT, Claude, Gemini individual outputs)
  if (aiTurn.batchResponses) {
    Object.entries(aiTurn.batchResponses).forEach(([providerId, response]) => {
      if (response.text?.trim()) {
        sources.push({
          id: `batch-${providerId}-${Date.now()}`,
          type: 'batch',
          providerId,
          content: response.text,
          status: response.status,
          metadata: response.meta
        });
      }
    });
  }
  
  // Extract synthesis responses (multi-take arrays per provider)
  if (aiTurn.synthesisResponses) {
    Object.entries(aiTurn.synthesisResponses).forEach(([providerId, responses]) => {
      const list = Array.isArray(responses) ? responses : [responses as unknown as ProviderResponse];
      list.forEach((response, idx) => {
        if (response?.text?.trim()) {
          sources.push({
            id: `synthesis-${providerId}-${idx}-${Date.now()}`,
            type: 'synthesis',
            providerId,
            content: response.text,
            status: response.status,
            metadata: response.meta
          });
        }
      });
    });
  }
  
  // Legacy synthesis response support
  if (aiTurn.synthesisResponse && aiTurn.synthesisResponse.text?.trim()) {
    sources.push({
      id: `synthesis-legacy-${Date.now()}`,
      type: 'synthesis',
      providerId: 'synthesis',
      content: aiTurn.synthesisResponse.text,
      status: aiTurn.synthesisResponse.status,
      metadata: aiTurn.synthesisResponse.meta
    });
  }
  
  // Extract ensemble responses (multi-take arrays per provider)
  if (aiTurn.ensembleResponses) {
    Object.entries(aiTurn.ensembleResponses).forEach(([providerId, responses]) => {
      const list = Array.isArray(responses) ? responses : [responses as unknown as ProviderResponse];
      list.forEach((response, idx) => {
        if (response?.text?.trim()) {
          sources.push({
            id: `ensemble-${providerId}-${idx}-${Date.now()}`,
            type: 'ensemble',
            providerId,
            content: response.text,
            status: response.status,
            metadata: response.meta
          });
        }
      });
    });
  }
  
  // Legacy ensemble response support
  if (aiTurn.ensembleResponse && aiTurn.ensembleResponse.text?.trim()) {
    sources.push({
      id: `ensemble-legacy-${Date.now()}`,
      type: 'ensemble',
      providerId: 'ensemble',
      content: aiTurn.ensembleResponse.text,
      status: aiTurn.ensembleResponse.status,
      metadata: aiTurn.ensembleResponse.meta
    });
  }
  
  // Extract hidden batch outputs (for synthesis-first workflow)
  if (aiTurn.hiddenBatchOutputs) {
    Object.entries(aiTurn.hiddenBatchOutputs).forEach(([providerId, response]) => {
      if (response.text?.trim()) {
        sources.push({
          id: `hidden-${providerId}-${Date.now()}`,
          type: 'hidden',
          providerId,
          content: response.text,
          status: response.status,
          metadata: response.meta
        });
      }
    });
  }
  
  // Legacy providerResponses support (if not already covered)
  if (aiTurn.providerResponses && !aiTurn.batchResponses) {
    Object.entries(aiTurn.providerResponses).forEach(([providerId, response]) => {
      if (response.text?.trim() && !sources.find(s => s.providerId === providerId)) {
        sources.push({
          id: `provider-${providerId}-${Date.now()}`,
          type: 'batch',
          providerId,
          content: response.text,
          status: response.status,
          metadata: response.meta
        });
      }
    });
  }
  
  return sources;
};

/**
 * Parse content into granular units based on granularity level
 */
export const parseIntoGranularUnits = (
  content: string,
  granularity: 'full' | 'paragraph' | 'sentence',
  sourceId: string,
  providerId: string
): GranularUnit[] => {
  if (!content || !content.trim()) {
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
 * Serialize Slate editor content to plain text
 */
export const serializeToPlainText = (nodes: any[]): string => {
  return nodes
    .map(node => {
      if (node.text !== undefined) {
        return node.text;
      }
      if (node.children) {
        return serializeToPlainText(node.children);
      }
      return '';
    })
    .join('\n');
};

/**
 * Check if an AiTurn has composable content
 */
export const hasComposableContent = (aiTurn: AiTurn): boolean => {
  const sources = extractComposableContent(aiTurn);
  return sources.length > 0;
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
      return content; // Already in markdown-friendly format
      
    case 'html':
      return content
        .split('\n\n')
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('\n');
      
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
  return content
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .length;
};

/**
 * Estimate reading time in minutes
 */
export const estimateReadingTime = (content: string): number => {
  const wordCount = calculateWordCount(content);
  const wordsPerMinute = 200;
  return Math.ceil(wordCount / wordsPerMinute);
};
