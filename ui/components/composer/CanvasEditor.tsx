import { useCallback, useMemo } from 'react';
import { Slate, Editable, RenderElementProps, RenderLeafProps } from 'slate-react';
import { BaseEditor, Descendant } from 'slate';
import { ReactEditor } from 'slate-react';
import type { SlateDescendant } from '../../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDroppable } from '@dnd-kit/core';

interface CanvasEditorProps {
  editor: BaseEditor & ReactEditor;
  value: SlateDescendant[];
  onChange: (value: SlateDescendant[]) => void;
  onRefine: () => void;
}

// Custom element renderer for Slate
const Element = ({ attributes, children, element }: RenderElementProps) => {
  const style = {
    margin: '8px 0',
  };
  
  switch (element.type) {
    case 'composed-content':
      return (
        <div
          {...attributes}
          style={{
            ...style,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '12px',
            position: 'relative',
          }}
        >
          {(element as any).metadata && (
            <div
              style={{
                fontSize: '10px',
                color: '#64748b',
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              contentEditable={false}
            >
              <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                {(element as any).providerId || 'Unknown'}
              </span>
              <span>•</span>
              <span style={{ textTransform: 'capitalize' }}>
                {(element as any).metadata?.granularity || 'content'}
              </span>
            </div>
          )}
          <div style={{ color: '#e2e8f0', lineHeight: '1.6' }}>{children}</div>
        </div>
      );
    case 'heading':
      return (
        <h2 {...attributes} style={{ ...style, fontSize: '20px', fontWeight: 600, color: '#e2e8f0' }}>
          {children}
        </h2>
      );
    case 'paragraph':
    default:
      return (
        <p {...attributes} style={{ ...style, color: '#e2e8f0', lineHeight: '1.6' }}>
          {children}
        </p>
      );
  }
};

// Custom leaf renderer for Slate
const Leaf = ({ attributes, children, leaf }: RenderLeafProps) => {
  let content = children;
  
  if ((leaf as any).bold) {
    content = <strong>{content}</strong>;
  }
  
  if ((leaf as any).italic) {
    content = <em>{content}</em>;
  }
  
  if ((leaf as any).code) {
    content = (
      <code
        style={{
          background: '#1e293b',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '0.9em',
        }}
      >
        {content}
      </code>
    );
  }
  
  return <span {...attributes}>{content}</span>;
};

const CanvasEditor = ({ editor, value, onChange, onRefine }: CanvasEditorProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'canvas-dropzone',
  });
  
  const renderElement = useCallback((props: RenderElementProps) => <Element {...props} />, []);
  const renderLeaf = useCallback((props: RenderLeafProps) => <Leaf {...props} />, []);
  
  return (
    <div
      style={{
        flex: 1,
        background: '#1e293b',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        border: '2px solid',
        borderColor: isOver ? '#8b5cf6' : '#334155',
        transition: 'border-color 0.2s ease',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#e2e8f0' }}>
            Composition Canvas
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
            Edit and arrange your content here
          </div>
        </div>
        
        <button
          onClick={onRefine}
          style={{
            background: '#8b5cf6',
            border: '1px solid #8b5cf6',
            borderRadius: '8px',
            padding: '6px 12px',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
          title="AI-powered refinement (Coming in Phase 3)"
        >
          <span style={{ fontSize: '14px' }}>✨</span>
          Refine
        </button>
      </div>
      
      <div
        ref={setNodeRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          background: '#0f172a',
          borderRadius: '8px',
          border: '1px solid #1e293b',
        }}
      >
        <Slate
          editor={editor}
          initialValue={value as Descendant[]}
  onChange={onChange as (value: Descendant[]) => void}
        >
          <Editable
            renderElement={renderElement}
            renderLeaf={renderLeaf}
            placeholder="Drag content from the left panel to start composing..."
            style={{
              minHeight: '100%',
              outline: 'none',
              color: '#e2e8f0',
              fontSize: '14px',
              lineHeight: '1.6',
            }}
          />
        </Slate>
      </div>
      
      {isOver && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(139, 92, 246, 0.9)',
            color: '#fff',
            padding: '16px 32px',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 600,
            pointerEvents: 'none',
            zIndex: 10,
            boxShadow: '0 10px 40px rgba(139, 92, 246, 0.4)',
          }}
        >
          Drop here to add content
        </div>
      )}
    </div>
  );
};

export default CanvasEditor;
