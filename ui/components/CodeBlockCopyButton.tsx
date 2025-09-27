import { useState, useCallback } from 'react';

interface CodeBlockCopyButtonProps {
  text: string;
  className?: string;
}

export const CodeBlockCopyButton = ({ text, className = '' }: CodeBlockCopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy code block"
      className={`copy-button ${className}`}
      style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        background: 'rgba(255, 255, 255, 0.1)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '4px',
        padding: '4px 8px',
        color: '#94a3b8',
        fontSize: '12px',
        cursor: 'pointer',
        opacity: 0,
        transition: 'opacity 0.2s ease',
      }}
    >
      {copied ? '✓' : '📋'} {copied ? 'Copied' : 'Copy'}
    </button>
  );
};