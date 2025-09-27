import { useState, useEffect, useRef } from 'react';
import { CodeBlockCopyButton } from './CodeBlockCopyButton';

// Simple language detection for TypeScript/JavaScript
const detectLanguage = (code: string): string => {
  const trimmed = code.trim();
  
  // Check for common TypeScript patterns
  if (trimmed.includes('interface ') || 
      trimmed.includes('type ') || 
      trimmed.includes('declare ') ||
      trimmed.includes(': ') && trimmed.includes('=>')) {
    return 'typescript';
  }
  
  // Check for common JavaScript patterns
  if (trimmed.includes('const ') || 
      trimmed.includes('let ') || 
      trimmed.includes('function ') ||
      trimmed.includes('=>')) {
    return 'javascript';
  }
  
  return 'text';
};

interface CodeBlockWrapperProps {
  children: string;
  className?: string;
  style?: React.CSSProperties;
}

export const CodeBlockWrapper = ({ children, className = '', style }: CodeBlockWrapperProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [codeBlocks, setCodeBlocks] = useState<Array<{ start: number; end: number; text: string; language?: string; isInline: boolean }>>([]);

  useEffect(() => {
    if (!children) return;

    // Enhanced regex to find code blocks with optional language specification
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```|`([^`]+)`/g;
    const blocks: Array<{ start: number; end: number; text: string; language?: string; isInline: boolean }> = [];
    let match;

    while ((match = codeBlockRegex.exec(children)) !== null) {
      const isInline = match[3] !== undefined; // Check if it's inline code (single backtick)
      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        text: (match[2] || match[3]).trim(), // Capture group 2 for ``` or group 3 for `
        language: isInline ? undefined : (match[1] || detectLanguage(match[2])),
        isInline
      });
    }

    setCodeBlocks(blocks);
  }, [children]);

  if (!children) return null;

  // If no code blocks found, render as plain text
  if (codeBlocks.length === 0) {
    return <div className={className} style={style}>{children}</div>;
  }

  // Split content and render with code blocks
  const parts: JSX.Element[] = [];
  let lastIndex = 0;

  codeBlocks.forEach((block, index) => {
    // Add text before code block
    if (block.start > lastIndex) {
      parts.push(
        <span key={`text-${index}`}>{children.slice(lastIndex, block.start)}</span>
      );
    }

    // Add code block with copy button
    const isMultiLine = block.text.includes('\n');
    const CodeComponent = isMultiLine ? 'pre' : 'code';
    const language = block.language || (isMultiLine ? 'text' : 'text');
    
    parts.push(
      <div key={`code-${index}`} style={{ position: 'relative', margin: '8px 0' }}>
        <CodeComponent
          className={isMultiLine ? `language-${language}` : ''}
          style={{
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            padding: isMultiLine ? '16px' : '4px 8px',
            color: '#e2e8f0',
            fontSize: '13px',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            overflowX: 'auto',
            display: 'block',
            margin: 0,
          }}
        >
          {block.text}
        </CodeComponent>
        <CodeBlockCopyButton text={block.text} />
      </div>
    );

    lastIndex = block.end;
  });

  // Add remaining text
  if (lastIndex < children.length) {
    parts.push(
      <span key="text-final">{children.slice(lastIndex)}</span>
    );
  }

  return <div className={className} style={style}>{parts}</div>;
};