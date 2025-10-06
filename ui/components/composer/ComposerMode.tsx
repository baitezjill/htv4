import { useMemo, useCallback } from 'react';
import { createEditor, Transforms, Editor, Element as SlateElement, BaseEditor } from 'slate';
import { Slate, Editable, withReact, ReactEditor } from 'slate-react';
import { DndContext, DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { v4 as uuidv4 } from 'uuid';
import type { AiTurn, SlateDescendant, GranularUnit, ComposerState } from '../../types';
import { extractComposableContent, serializeToPlainText } from '../../utils/composerUtils';
import { useComposerReducer } from '../../hooks/useComposerReducer';
import ComposerToolbar from './ComposerToolbar';
import SourcePanel from './SourcePanel';
import CanvasEditor from './CanvasEditor';

interface ComposerModeProps {
  aiTurn: AiTurn;
  sessionId: string | null;
  onExit: () => void;
  onUpdateAiTurn?: (aiTurnId: string, updates: Partial<AiTurn>) => void;
}

// Slate plugin for composer-specific behavior
const withComposer = (editor: ReactEditor) => {
  const { insertData, normalizeNode } = editor;
  
  // Handle paste events
  editor.insertData = (data: DataTransfer) => {
    const text = data.getData('text/plain');
    if (text) {
      Transforms.insertText(editor, text);
      return;
    }
    insertData(data);
  };
  
  // Normalize composed nodes
  editor.normalizeNode = (entry) => {
    const [node, path] = entry;
    
    // Ensure composed-content nodes maintain metadata
    if ('type' in node && node.type === 'composed-content') {
      if (!('metadata' in node) || !node.metadata) {
        Transforms.setNodes(
          editor,
          { metadata: { granularity: 'unknown' } },
          { at: path }
        );
      }
    }
    
    normalizeNode(entry);
  };
  
  return editor;
};

const ComposerMode = ({ aiTurn, sessionId, onExit, onUpdateAiTurn }: ComposerModeProps) => {
  // State management with useReducer
  const { state: composerState, actions } = useComposerReducer(aiTurn.composerState);
  
  // Initialize Slate editor
  const editor = useMemo(() => withComposer(withReact(createEditor())), []);
  
  // Extract composable sources from AI turn
  const sources = useMemo(() => extractComposableContent(aiTurn), [aiTurn]);
  
  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor)
  );
  
  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) return;
    
    const draggedUnit = active.data.current as GranularUnit;
    
    if (!draggedUnit) return;
    
    // Insert the dragged content into the editor
    // For now, append to the end - we'll add magnetic snap in Phase 2
    const newNode: SlateDescendant = {
      type: 'composed-content',
      sourceId: draggedUnit.sourceId,
      providerId: draggedUnit.providerId,
      children: [{ text: draggedUnit.text }],
      metadata: {
        originalIndex: draggedUnit.index,
        granularity: draggedUnit.type,
        timestamp: Date.now(),
      },
    };
    
    // Insert at the end of the document
    Transforms.insertNodes(editor, newNode, {
      at: [editor.children.length],
    });
    
    // Add a paragraph break after
    Transforms.insertNodes(
      editor,
      { type: 'paragraph', children: [{ text: '' }] },
      { at: [editor.children.length] }
    );
    
    actions.setDirty(true);
  }, [editor, actions]);
  
  // Handle canvas content change
  const handleCanvasChange = useCallback((newContent: SlateDescendant[]) => {
    actions.setCanvasContent(newContent);
  }, [actions]);
  
  // Save composer state
  const handleSave = useCallback(() => {
    if (onUpdateAiTurn) {
      const stateToSave = {
        ...composerState,
        lastModified: Date.now(),
      };
      
      onUpdateAiTurn(aiTurn.id, { composerState: stateToSave });
      actions.markSaved();
    }
  }, [composerState, aiTurn.id, onUpdateAiTurn, actions]);
  
  // Handle export
  const handleExport = useCallback(async () => {
    const plainText = serializeToPlainText(composerState.canvasContent);
    
    try {
      await navigator.clipboard.writeText(plainText);
      // TODO: Show success notification
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // TODO: Show error notification
    }
    
    // Track export in history
    if (plainText) {
      actions.addExport({
        id: uuidv4(),
        timestamp: Date.now(),
        format: 'text',
        content: plainText,
        metadata: {
          snapshot: plainText.substring(0, 200),
        },
      });
    }
  }, [composerState.canvasContent, actions]);
  
  // Handle refinement (placeholder for Phase 3)
  const handleRefine = useCallback(async () => {
    // TODO: Implement refinement in Phase 3
    console.log('Refinement feature coming in Phase 3');
  }, []);
  
  return (
    <div
      className="composer-mode-container"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#0f172a',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ComposerToolbar
        granularity={composerState.granularity}
        onGranularityChange={actions.setGranularity}
        onExit={onExit}
        onSave={handleSave}
        onExport={handleExport}
        isDirty={composerState.isDirty}
      />
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div
          className="composer-split-view"
          style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden',
            gap: '16px',
            padding: '16px',
          }}
        >
          <SourcePanel
            sources={sources}
            granularity={composerState.granularity}
          />
          
          <CanvasEditor
            editor={editor}
            value={composerState.canvasContent}
            onChange={handleCanvasChange}
            onRefine={handleRefine}
          />
        </div>
      </DndContext>
    </div>
  );
};

export default ComposerMode;
