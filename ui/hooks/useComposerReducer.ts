import { useReducer, useCallback } from 'react';
import type { ComposerState, SlateDescendant, RefinementEntry, ExportEntry } from '../types';

// Composer Action Types
type ComposerAction =
  | { type: 'SET_CANVAS_CONTENT'; payload: SlateDescendant[] }
  | { type: 'SET_GRANULARITY'; payload: 'full' | 'paragraph' | 'sentence' }
  | { type: 'SET_DIRTY'; payload: boolean }
  | { type: 'ADD_REFINEMENT'; payload: RefinementEntry }
  | { type: 'ADD_EXPORT'; payload: ExportEntry }
  | { type: 'RESET_STATE'; payload: ComposerState }
  | { type: 'MARK_SAVED' };

// Reducer function
const composerReducer = (state: ComposerState, action: ComposerAction): ComposerState => {
  switch (action.type) {
    case 'SET_CANVAS_CONTENT':
      return {
        ...state,
        canvasContent: action.payload,
        isDirty: true,
        lastModified: Date.now(),
      };
    
    case 'SET_GRANULARITY':
      return {
        ...state,
        granularity: action.payload,
      };
    
    case 'SET_DIRTY':
      return {
        ...state,
        isDirty: action.payload,
      };
    
    case 'ADD_REFINEMENT':
      return {
        ...state,
        refinementHistory: [...(state.refinementHistory || []), action.payload],
        lastModified: Date.now(),
        isDirty: true,
      };
    
    case 'ADD_EXPORT':
      return {
        ...state,
        exportHistory: [...(state.exportHistory || []), action.payload],
      };
    
    case 'RESET_STATE':
      return action.payload;
    
    case 'MARK_SAVED':
      return {
        ...state,
        isDirty: false,
      };
    
    default:
      return state;
  }
};

// Initial state factory
const createInitialState = (existingState?: ComposerState): ComposerState => {
  const defaults: ComposerState = {
    granularity: 'full',
    canvasContent: [
      {
        type: 'paragraph',
        children: [{ text: '' }],
      },
    ],
    sourceMap: {},
    refinementHistory: [],
    exportHistory: [],
    isDirty: false,
    createdAt: Date.now(),
    lastModified: Date.now(),
  };

  return existingState ? { ...defaults, ...existingState } : defaults;
};

// Custom hook
export const useComposerReducer = (initialState?: ComposerState) => {
  const [state, dispatch] = useReducer(
    composerReducer,
    initialState || createInitialState()
  );
  
  // Action creators
  const setCanvasContent = useCallback((content: SlateDescendant[]) => {
    dispatch({ type: 'SET_CANVAS_CONTENT', payload: content });
  }, []);
  
  const setGranularity = useCallback((level: 'full' | 'paragraph' | 'sentence') => {
    dispatch({ type: 'SET_GRANULARITY', payload: level });
  }, []);
  
  const setDirty = useCallback((isDirty: boolean) => {
    dispatch({ type: 'SET_DIRTY', payload: isDirty });
  }, []);
  
  const addRefinement = useCallback((refinement: RefinementEntry) => {
    dispatch({ type: 'ADD_REFINEMENT', payload: refinement });
  }, []);
  
  const addExport = useCallback((exportEntry: ExportEntry) => {
    dispatch({ type: 'ADD_EXPORT', payload: exportEntry });
  }, []);
  
  const resetState = useCallback((newState: ComposerState) => {
    dispatch({ type: 'RESET_STATE', payload: newState });
  }, []);
  
  const markSaved = useCallback(() => {
    dispatch({ type: 'MARK_SAVED' });
  }, []);
  
  return {
    state,
    actions: {
      setCanvasContent,
      setGranularity,
      setDirty,
      addRefinement,
      addExport,
      resetState,
      markSaved,
    },
  };
};

export default useComposerReducer;
