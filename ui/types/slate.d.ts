// Slate custom type declarations for Composer Mode
// This file uses TypeScript declaration merging to extend Slate's built-in types
// so our custom elements and text nodes are properly typed.

import type { BaseEditor } from 'slate';
import type { ReactEditor } from 'slate-react';
import type { GranularUnit } from '../types';

// 1. Define the structure of our custom text nodes
type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

// 2. Define our custom element types
type ParagraphElement = {
  type: 'paragraph';
  children: CustomText[];
};

type ComposedContentElement = {
  type: 'composed-content';
  sourceId: string;
  providerId: string;
  metadata?: {
    originalIndex?: number;
    granularity?: GranularUnit['type'] | 'unknown';
    timestamp?: number;
  };
  children: CustomText[];
};

// Optional heading element used by CanvasEditor
type HeadingElement = {
  type: 'heading';
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  children: CustomText[];
};

// 3. Create the union of all custom element types
type CustomElement = ParagraphElement | ComposedContentElement | HeadingElement;

// 4. Extend Slate's CustomTypes via declaration merging
declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}