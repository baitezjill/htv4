# Composer Mode Integration Plan for Chrome Extension

## 1. State Management Integration

### 1.1 Accessing Batch/Synthesis Data

```typescript
// Extend AiTurn interface with composer-specific fields
interface AiTurn {
  // Existing fields...
  batchResponses?: Map<string, ProviderResponse>;
  synthesisResponses?: ProviderResponse;
  ensembleResponses?: ProviderResponse;
  hiddenBatchOutputs?: Map<string, ProviderResponse>;
  
  // New composer-specific fields
  composerState?: {
    canvasContent: SlateDescendant[];
    lastSaved: number;
    isDirty: boolean;
    refinementHistory: RefinementEntry[];
    sourceMapping: ContentSourceMap; // Maps content to original provider/position
  };
}

interface ContentSourceMap {
  [nodeId: string]: {
    providerId: string;
    originalIndex: number; // Position in original response
    granularity: 'full' | 'paragraph' | 'sentence';
    text: string;
  };
}
```

### 1.2 Composer Canvas State Strategy

```typescript
// New React context for Composer Mode
interface ComposerContextValue {
  activeAiTurn: AiTurn | null;
  canvasContent: SlateDescendant[];
  granularityLevel: 'full' | 'paragraph' | 'sentence';
  selectedSources: Map<string, ProviderResponse>;
  updateCanvas: (content: SlateDescendant[]) => void;
  persistComposerState: () => void;
}

// Store in App.tsx alongside messages
const [composerSession, setComposerSession] = useState<{
  aiTurnId: string;
  canvasContent: SlateDescendant[];
  isDirty: boolean;
} | null>(null);
```

### 1.3 Persistence Layer Integration

```typescript
// Extend persistence service
interface ComposerPersistence {
  saveComposerState: (sessionId: string, aiTurnId: string, state: ComposerState) => Promise<void>;
  loadComposerState: (sessionId: string, aiTurnId: string) => Promise<ComposerState | null>;
}

// Add to api module
api.saveComposerState = async (sessionId, aiTurnId, state) => {
  return sendMessage({
    action: 'saveComposerState',
    payload: { sessionId, aiTurnId, state }
  });
};
```

## 2. UI Architecture

### 2.1 Component Structure

```typescript
// New component hierarchy
src/ui/
├── components/
│   ├── composer/
│   │   ├── ComposerMode.tsx              // Main container
│   │   ├── SourcePanel.tsx               // Left panel with AI outputs
│   │   ├── CanvasEditor.tsx              // Right panel Slate editor
│   │   ├── GranularityControls.tsx       // Zoom level controls
│   │   ├── DraggableContent.tsx          // Wrapper for draggable units
│   │   ├── RefinementControls.tsx        // Refine button and options
│   │   └── ComposerToolbar.tsx           // Top toolbar
│   └── ...existing components
```

### 2.2 Navigation & Entry Points

```typescript
// In App.tsx - Add routing logic
enum ViewMode {
  CHAT = 'chat',
  COMPOSER = 'composer'
}

const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.CHAT);

// Entry button in existing UI (after synthesis completes)
const ComposerEntryButton = ({ aiTurn }: { aiTurn: AiTurn }) => {
  const hasComposableContent = aiTurn.synthesisResponses || 
                                (aiTurn.batchResponses && aiTurn.batchResponses.size > 0);
  
  if (!hasComposableContent) return null;
  
  return (
    <Button
      onClick={() => {
        setViewMode(ViewMode.COMPOSER);
        setActiveComposerTurn(aiTurn);
      }}
    >
      Open in Composer Mode
    </Button>
  );
};
```

### 2.3 Composer Mode Container

```typescript
const ComposerMode: React.FC<ComposerModeProps> = ({ aiTurn, onExit }) => {
  const [granularity, setGranularity] = useState<'full' | 'paragraph' | 'sentence'>('full');
  const [editor] = useState(() => withReact(createEditor()));
  
  return (
    <DndContext 
      sensors={[useSensor(PointerSensor), useSensor(KeyboardSensor)]}
      onDragEnd={handleDragEnd}
    >
      <div className="composer-container">
        <ComposerToolbar 
          granularity={granularity}
          onGranularityChange={setGranularity}
          onExit={onExit}
        />
        
        <div className="composer-split-view">
          <SourcePanel 
            aiTurn={aiTurn}
            granularity={granularity}
          />
          
          <CanvasEditor 
            editor={editor}
            onRefine={handleRefine}
          />
        </div>
      </div>
    </DndContext>
  );
};
```

## 3. Data Flow for Composer

### 3.1 Reading AI Outputs

```typescript
// Utility to extract all available responses
const extractComposableContent = (aiTurn: AiTurn): ComposableSource[] => {
  const sources: ComposableSource[] = [];
  
  // Extract batch responses
  if (aiTurn.batchResponses) {
    aiTurn.batchResponses.forEach((response, providerId) => {
      sources.push({
        id: `batch-${providerId}`,
        type: 'batch',
        providerId,
        content: response.text,
        status: response.status
      });
    });
  }
  
  // Extract synthesis response
  if (aiTurn.synthesisResponses) {
    sources.push({
      id: 'synthesis',
      type: 'synthesis',
      providerId: 'synthesis',
      content: aiTurn.synthesisResponses.text,
      status: aiTurn.synthesisResponses.status
    });
  }
  
  // Extract ensemble responses
  if (aiTurn.ensembleResponses) {
    sources.push({
      id: 'ensemble',
      type: 'ensemble',
      providerId: 'ensemble',
      content: aiTurn.ensembleResponses.text,
      status: aiTurn.ensembleResponses.status
    });
  }
  
  return sources;
};
```

### 3.2 Granular Selection Processing

```typescript
// Content parsing utilities
const parseIntoGranularUnits = (
  content: string, 
  granularity: 'full' | 'paragraph' | 'sentence'
): GranularUnit[] => {
  switch (granularity) {
    case 'full':
      return [{ id: uuid(), text: content, type: 'full' }];
      
    case 'paragraph':
      return content
        .split(/\n\n+/)
        .filter(p => p.trim())
        .map(text => ({ id: uuid(), text, type: 'paragraph' }));
        
    case 'sentence':
      // Use compromise or simple regex for sentence splitting
      return content
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim())
        .map(text => ({ id: uuid(), text, type: 'sentence' }));
        
    default:
      return [];
  }
};
```

### 3.3 Drag & Drop Handler

```typescript
const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  
  if (!over) return;
  
  const draggedContent = active.data.current as GranularUnit;
  const targetPosition = findInsertionPoint(editor, over.rect);
  
  // Insert at magnetic snap point
  Transforms.insertNodes(
    editor,
    {
      type: 'composed-content',
      sourceId: draggedContent.sourceId,
      providerId: draggedContent.providerId,
      children: [{ text: draggedContent.text }],
      metadata: {
        originalIndex: draggedContent.index,
        granularity: draggedContent.type
      }
    },
    { at: targetPosition }
  );
  
  // Track source mapping
  updateSourceMapping(draggedContent, targetPosition);
};
```

## 4. Refinement Integration

### 4.1 Refinement API Strategy

```typescript
// New API endpoint for cheap refinement
api.executeComposerRefinement = async (
  sessionId: string,
  composedContent: string,
  refinementOptions?: RefinementOptions
): Promise<RefinementResponse> => {
  return sendMessage({
    action: 'executeComposerRefinement',
    payload: {
      sessionId,
      content: composedContent,
      options: {
        model: refinementOptions?.model || 'gpt-3.5-turbo',
        temperature: 0.3,
        maxTokens: refinementOptions?.maxTokens || 2000,
        systemPrompt: COMPOSER_REFINEMENT_PROMPT
      }
    }
  });
};

// Refinement prompt template
const COMPOSER_REFINEMENT_PROMPT = `
You are a professional editor. Take the user's composed content and:
1. Fix any grammatical or spelling errors
2. Smooth transitions between segments
3. Ensure consistent tone and style
4. Maintain the original meaning and key points
5. Remove redundancies while preserving important information

Return only the refined text without explanations.
`;
```

### 4.2 Refinement State Management

```typescript
interface RefinementEntry {
  id: string;
  timestamp: number;
  inputContent: string;
  refinedContent: string;
  model: string;
  status: 'pending' | 'completed' | 'error';
}

// Store refinement history in AiTurn
const handleRefine = async () => {
  const plainText = serializeToPlainText(editor.children);
  const refinementId = uuid();
  
  // Add pending entry
  updateAiTurn(aiTurn.id, {
    composerState: {
      ...aiTurn.composerState,
      refinementHistory: [
        ...aiTurn.composerState.refinementHistory,
        {
          id: refinementId,
          timestamp: Date.now(),
          inputContent: plainText,
          status: 'pending'
        }
      ]
    }
  });
  
  // Execute refinement
  try {
    const response = await api.executeComposerRefinement(sessionId, plainText);
    
    // Update with result
    updateRefinementEntry(refinementId, {
      refinedContent: response.text,
      status: 'completed'
    });
    
    // Option to use as next input
    if (options.useAsNextInput) {
      createNewUserTurn(response.text);
    }
  } catch (error) {
    updateRefinementEntry(refinementId, { status: 'error' });
  }
};
```

## 5. API/Backend Changes

### 5.1 New Endpoints

```typescript
// Background script additions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'executeComposerRefinement':
      handleComposerRefinement(request.payload)
        .then(sendResponse)
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'saveComposerState':
      persistComposerState(request.payload)
        .then(sendResponse)
        .catch(error => sendResponse({ error: error.message }));
      return true;
      
    case 'loadComposerState':
      loadComposerState(request.payload)
        .then(sendResponse)
        .catch(error => sendResponse({ error: error.message }));
      return true;
  }
});
```

### 5.2 Persistence Schema

```typescript
// IndexedDB schema extension
interface ComposerStateSchema {
  sessionId: string;
  aiTurnId: string;
  canvasContent: any; // Slate JSON
  sourceMapping: ContentSourceMap;
  refinementHistory: RefinementEntry[];
  createdAt: number;
  updatedAt: number;
}

// Add new object store
const COMPOSER_STORE_NAME = 'composerStates';
```

## 6. Libraries and Dependencies

### 6.1 Package Dependencies

```json
{
  "dependencies": {
    "slate": "^0.94.0",
    "slate-react": "^0.94.0",
    "@dnd-kit/core": "^6.0.0",
    "@dnd-kit/sortable": "^7.0.0",
    "@dnd-kit/utilities": "^3.2.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^9.0.0"
  }
}
```

### 6.2 Build Configuration

```javascript
// esbuild.config.js updates
const buildOptions = {
  ...existingOptions,
  loader: {
    ...existingLoaders,
    '.css': 'css' // For @dnd-kit styles
  },
  external: [...existingExternals],
  // No additional changes needed for Slate/dnd-kit
};
```

### 6.3 Slate Configuration

```typescript
// Slate plugins and configuration
const withComposer = (editor: ReactEditor) => {
  const { insertData, normalizeNode } = editor;
  
  // Handle paste events
  editor.insertData = (data: DataTransfer) => {
    // Custom paste handling for composed content
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
    if (Element.isElement(node) && node.type === 'composed-content') {
      if (!node.metadata) {
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
```

## 7. Migration/Compatibility

### 7.1 Backward Compatibility

```typescript
// Feature detection for existing sessions
const isComposerCompatible = (aiTurn: AiTurn): boolean => {
  // Check if turn has composable content
  return !!(
    aiTurn.synthesisResponses ||
    aiTurn.batchResponses?.size > 0 ||
    aiTurn.ensembleResponses
  );
};

// Migration for existing sessions
const migrateAiTurnForComposer = (aiTurn: AiTurn): AiTurn => {
  if (!aiTurn.composerState) {
    return {
      ...aiTurn,
      composerState: {
        canvasContent: [],
        lastSaved: Date.now(),
        isDirty: false,
        refinementHistory: [],
        sourceMapping: {}
      }
    };
  }
  return aiTurn;
};
```

### 7.2 Feature Flag Strategy

```typescript
// Feature flag configuration
interface FeatureFlags {
  composerModeEnabled: boolean;
  composerRefinementEnabled: boolean;
  composerAutoSaveEnabled: boolean;
}

// Check in UI
const FEATURE_FLAGS: FeatureFlags = {
  composerModeEnabled: process.env.COMPOSER_MODE !== 'false',
  composerRefinementEnabled: true,
  composerAutoSaveEnabled: true
};

// Conditional rendering
{FEATURE_FLAGS.composerModeEnabled && (
  <ComposerEntryButton aiTurn={aiTurn} />
)}
```

## 8. Enhanced Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Objective**: Establish the core infrastructure and component architecture for Composer Mode

#### 1.1 Dependency Management
- **Install required dependencies**:
  ```bash
  npm install slate slate-react @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities uuid
  npm install --save-dev @types/uuid
  ```
- **Verify compatibility** with existing build system (esbuild)
- **Update package.json** with peer dependencies and version constraints

#### 1.2 Type System Extensions
- **Extend AiTurn interface** in `ui/types.ts`:
  ```typescript
  interface ComposerState {
    canvasContent: SlateDescendant[];
    lastSaved: number;
    isDirty: boolean;
    refinementHistory: RefinementEntry[];
    sourceMapping: ContentSourceMap;
    granularityLevel: 'full' | 'paragraph' | 'sentence';
    exportHistory: ExportEntry[];
  }
  ```
- **Create composer-specific type declarations**:
  - `GranularUnit`, `ComposableSource`, `RefinementEntry`
  - `ContentSourceMap`, `ExportEntry`, `ComposerContextValue`
- **Add feature flag types** for progressive rollout

#### 1.3 Core Component Architecture
- **Create component directory structure**:
  ```
  ui/components/composer/
  ├── ComposerMode.tsx              // Main container & routing
  ├── SourcePanel.tsx               // AI outputs display
  ├── CanvasEditor.tsx              // Slate-based editor
  ├── ComposerToolbar.tsx           // Top navigation & controls
  ├── GranularityControls.tsx       // Content zoom controls
  ├── DraggableContent.tsx          // Drag source wrapper
  ├── RefinementControls.tsx        // Text improvement tools
  └── ExportControls.tsx            // Output options
  ```
- **Implement base component shells** with TypeScript interfaces
- **Set up component prop contracts** and error boundaries

#### 1.4 Navigation & Routing Logic
- **Define ViewMode enum** in `ui/constants.ts`:
  ```typescript
  enum ViewMode {
    CHAT = 'chat',
    COMPOSER = 'composer',
    HISTORY = 'history'
  }
  ```
- **Implement routing logic** in `App.tsx`:
  - State management for view transitions
  - URL hash-based routing for deep linking
  - Breadcrumb navigation system
- **Create entry points** from existing UI:
  - "Open in Composer" button in AiTurnBlock
  - Context menu integration
  - Keyboard shortcut (Ctrl+Shift+C)

#### 1.5 Basic Slate Integration
- **Configure Slate editor** with custom plugins:
  - `withComposer` plugin for content handling
  - `withSourceTracking` for provenance mapping
  - `withMagneticSnap` for placement assistance
- **Implement basic editor shell** with placeholder content
- **Set up editor state management** with React context

**Deliverables**:
- ✅ All dependencies installed and configured
- ✅ Type system extended with composer interfaces
- ✅ Component architecture established
- ✅ Navigation between chat/composer modes working
- ✅ Basic Slate editor renders and accepts input

---

### Phase 2: Core Functionality Implementation (Week 2-3)
**Objective**: Build the primary drag-and-drop composition workflow

#### 2.1 SourcePanel Development
- **AI Output Display System**:
  - Render synthesis, ensemble, and batch responses
  - Color-coded provider identification
  - Response status indicators (complete, streaming, error)
  - Collapsible sections for organization
- **Granularity Controls Implementation**:
  ```typescript
  const parseIntoGranularUnits = (
    content: string, 
    granularity: 'full' | 'paragraph' | 'sentence'
  ): GranularUnit[] => {
    // Smart parsing with NLP-aware sentence splitting
    // Preserve formatting and structure
    // Generate unique IDs for tracking
  }
  ```
- **Content Filtering & Organization**:
  - Search/filter by provider or content type
  - Sort by relevance, length, or creation time
  - Bookmark frequently used segments
- **Preview & Selection Tools**:
  - Hover previews for long content
  - Multi-select for batch operations
  - Quick copy-to-clipboard functionality

#### 2.2 Drag-and-Drop System
- **DndContext Integration**:
  ```typescript
  <DndContext 
    sensors={[useSensor(PointerSensor), useSensor(KeyboardSensor)]}
    onDragStart={handleDragStart}
    onDragOver={handleDragOver}
    onDragEnd={handleDragEnd}
    collisionDetection={closestCenter}
  >
  ```
- **Draggable Content Components**:
  - Visual drag indicators and ghost elements
  - Touch-friendly drag handles for mobile
  - Accessibility support (keyboard navigation)
- **Drop Zone Implementation**:
  - Magnetic snap points in editor
  - Visual drop indicators and highlighting
  - Insertion point calculation and preview
- **Advanced Drag Features**:
  - Multi-item drag selection
  - Drag-to-reorder within canvas
  - Drag-to-delete with confirmation

#### 2.3 CanvasEditor Enhancement
- **Slate-based Rich Text Editor**:
  - Custom node types for composed content
  - Inline formatting (bold, italic, code)
  - Block-level elements (headers, lists, quotes)
- **Magnetic Snap Placement**:
  ```typescript
  const findMagneticSnapPoint = (
    editor: Editor, 
    dropPosition: Point
  ): Path => {
    // Calculate optimal insertion points
    // Consider content structure and flow
    // Provide visual feedback during drag
  }
  ```
- **Content Source Tracking**:
  - Maintain provenance metadata for each node
  - Visual indicators showing content origins
  - Source attribution in hover tooltips
- **Basic Formatting Controls**:
  - Toolbar with common formatting options
  - Keyboard shortcuts for power users
  - Format preservation from original sources

#### 2.4 State Management Integration
- **Canvas State Synchronization**:
  - Real-time updates between components
  - Optimistic UI updates with rollback
  - Conflict resolution for concurrent edits
- **Source Mapping System**:
  ```typescript
  interface ContentSourceMap {
    [nodeId: string]: {
      providerId: string;
      originalIndex: number;
      granularity: 'full' | 'paragraph' | 'sentence';
      text: string;
      timestamp: number;
      metadata: Record<string, any>;
    };
  }
  ```

**Deliverables**:
- ✅ SourcePanel displays AI outputs with granularity controls
- ✅ Drag-and-drop functionality working smoothly
- ✅ CanvasEditor accepts dropped content with proper formatting
- ✅ Source tracking and attribution system operational
- ✅ Basic composition workflow complete end-to-end

---

### Phase 3: Refinement System (Week 3-4)
**Objective**: Implement AI-powered content refinement and improvement tools

#### 3.1 Refinement API Development
- **Create refinement endpoint** in `ui/services/extension-api.ts`:
  ```typescript
  api.executeComposerRefinement = async (
    sessionId: string,
    composedContent: string,
    refinementOptions: RefinementOptions
  ): Promise<RefinementResponse> => {
    return sendMessage({
      action: 'executeComposerRefinement',
      payload: {
        sessionId,
        content: composedContent,
        options: {
          model: refinementOptions.model || 'gpt-3.5-turbo',
          temperature: 0.3,
          maxTokens: 2000,
          refinementType: refinementOptions.type,
          customInstructions: refinementOptions.instructions
        }
      }
    });
  };
  ```
- **Backend integration** in service worker:
  - Route refinement requests to appropriate providers
  - Handle rate limiting and error recovery
  - Implement cost-effective model selection
- **Refinement prompt templates**:
  - Grammar and style improvement
  - Tone adjustment (formal, casual, technical)
  - Length modification (expand, condense, summarize)
  - Structure optimization (flow, transitions, clarity)

#### 3.2 Refinement UI Controls
- **Text Modification Tools**:
  - Grammar and spell check integration
  - Style consistency enforcement
  - Readability score and suggestions
  - Tone analysis and adjustment options
- **Layout Adjustment Options**:
  - Paragraph restructuring suggestions
  - Heading hierarchy optimization
  - List and bullet point formatting
  - Visual spacing and flow improvements
- **Style Customization Features**:
  - Writing style presets (academic, business, creative)
  - Custom style guide enforcement
  - Brand voice consistency checking
  - Citation and reference formatting

#### 3.3 History & Version Control
- **Refinement History Tracking**:
  ```typescript
  interface RefinementEntry {
    id: string;
    timestamp: number;
    inputContent: string;
    refinedContent: string;
    refinementType: string;
    model: string;
    status: 'pending' | 'completed' | 'error';
    userRating?: number;
    appliedChanges: boolean;
  }
  ```
- **Version Control System**:
  - Snapshot creation before major changes
  - Branch-like editing with merge capabilities
  - Diff visualization for changes
  - Rollback to previous versions
- **State Comparison Views**:
  - Side-by-side before/after comparison
  - Inline change highlighting
  - Change summary and statistics
  - Export comparison reports

#### 3.4 Advanced Refinement Features
- **Batch Refinement Operations**:
  - Apply refinements to multiple sections
  - Consistent style across entire composition
  - Bulk grammar and formatting fixes
- **Interactive Refinement**:
  - Real-time suggestions as user types
  - Contextual improvement recommendations
  - Smart auto-complete based on content
- **Custom Refinement Rules**:
  - User-defined style preferences
  - Domain-specific terminology enforcement
  - Compliance checking (legal, medical, etc.)

**Deliverables**:
- ✅ Refinement API endpoint operational
- ✅ UI controls for text modification and styling
- ✅ History tracking with version control
- ✅ Comparison views and rollback functionality
- ✅ Batch and interactive refinement features

---

### Phase 4: State Management & Persistence (Week 4-5)
**Objective**: Implement robust data persistence and state management

#### 4.1 Persistence Layer Design
- **Storage Architecture**:
  ```typescript
  interface ComposerPersistence {
    saveComposerState: (sessionId: string, aiTurnId: string, state: ComposerState) => Promise<void>;
    loadComposerState: (sessionId: string, aiTurnId: string) => Promise<ComposerState | null>;
    exportComposition: (format: ExportFormat, options: ExportOptions) => Promise<string>;
    importComposition: (data: string, format: ImportFormat) => Promise<ComposerState>;
  }
  ```
- **IndexedDB Integration**:
  - Efficient storage for large compositions
  - Offline capability and sync when online
  - Automatic cleanup of old sessions
- **Cloud Sync Preparation**:
  - Data structure compatible with future cloud storage
  - Conflict resolution strategies
  - Privacy-preserving encryption options

#### 4.2 Local Storage Integration
- **Browser Storage Management**:
  - Chrome extension storage API integration
  - Storage quota monitoring and management
  - Data compression for large compositions
- **Session Recovery**:
  - Automatic recovery from browser crashes
  - Unsaved changes detection and recovery
  - Cross-tab synchronization
- **Data Migration**:
  - Version compatibility handling
  - Schema migration utilities
  - Backward compatibility maintenance

#### 4.3 State Serialization System
- **Efficient Serialization**:
  ```typescript
  const serializeComposerState = (state: ComposerState): string => {
    return JSON.stringify({
      version: COMPOSER_STATE_VERSION,
      canvasContent: serializeSlateContent(state.canvasContent),
      sourceMapping: compressSourceMapping(state.sourceMapping),
      refinementHistory: state.refinementHistory,
      metadata: {
        created: state.lastSaved,
        wordCount: calculateWordCount(state.canvasContent),
        sourceCount: Object.keys(state.sourceMapping).length
      }
    });
  };
  ```
- **Deserialization with Validation**:
  - Schema validation for imported data
  - Error recovery for corrupted states
  - Migration from older versions
- **Compression & Optimization**:
  - Content deduplication
  - Efficient diff storage for history
  - Lazy loading of large compositions

#### 4.4 Auto-save Functionality
- **Intelligent Auto-save**:
  - Debounced saves to prevent excessive writes
  - Change detection to avoid unnecessary saves
  - User activity monitoring for save timing
- **Save State Indicators**:
  - Visual feedback for save status
  - Conflict indicators and resolution UI
  - Manual save triggers for user control
- **Recovery Mechanisms**:
  - Automatic recovery prompts on startup
  - Multiple recovery point options
  - Data integrity verification

**Deliverables**:
- ✅ Robust persistence layer with IndexedDB
- ✅ Local storage integration and session recovery
- ✅ Efficient serialization/deserialization system
- ✅ Auto-save with intelligent change detection
- ✅ Data migration and version compatibility

---

### Phase 5: Performance Optimization & Polish (Week 5-6)
**Objective**: Optimize performance, enhance UX, and prepare for production

#### 5.1 Performance Optimization
- **Bundle Size Reduction**:
  - Code splitting for composer components
  - Lazy loading of heavy dependencies
  - Tree shaking optimization
  - Dynamic imports for optional features
- **Rendering Efficiency**:
  ```typescript
  // Virtualization for large source panels
  const VirtualizedSourcePanel = React.memo(({ sources }) => {
    const [virtualizer] = useVirtualizer({
      count: sources.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 100,
      overscan: 5
    });
    
    return (
      <div ref={parentRef} className="source-panel-container">
        {virtualizer.getVirtualItems().map(virtualRow => (
          <SourceItem key={virtualRow.key} source={sources[virtualRow.index]} />
        ))}
      </div>
    );
  });
  ```
- **Drag-and-Drop Responsiveness**:
  - Optimized collision detection algorithms
  - Reduced re-renders during drag operations
  - Smooth animations with CSS transforms
  - Touch gesture optimization for mobile

#### 5.2 User Experience Enhancements
- **Accessibility Improvements**:
  - ARIA labels and roles for screen readers
  - Keyboard navigation for all features
  - High contrast mode support
  - Focus management and visual indicators
- **Mobile Responsiveness**:
  - Touch-friendly drag handles and controls
  - Responsive layout for smaller screens
  - Gesture-based navigation
  - Mobile-optimized context menus
- **Visual Polish**:
  - Smooth transitions and micro-animations
  - Consistent design system integration
  - Loading states and progress indicators
  - Error states with helpful messaging

#### 5.3 Advanced Features
- **Keyboard Shortcuts**:
  ```typescript
  const COMPOSER_SHORTCUTS = {
    'Ctrl+S': 'save',
    'Ctrl+Z': 'undo',
    'Ctrl+Y': 'redo',
    'Ctrl+Shift+R': 'refine',
    'Ctrl+Shift+E': 'export',
    'Escape': 'exitComposer'
  };
  ```
- **Export Options**:
  - Multiple format support (Markdown, HTML, PDF, DOCX)
  - Custom export templates
  - Batch export capabilities
  - Direct sharing to external platforms
- **Import Capabilities**:
  - Import from various document formats
  - Paste from clipboard with formatting preservation
  - Integration with external content sources

#### 5.4 Error Handling & Resilience
- **Comprehensive Error Boundaries**:
  - Component-level error isolation
  - Graceful degradation strategies
  - User-friendly error messages
  - Automatic error reporting
- **Network Resilience**:
  - Offline mode capabilities
  - Request retry mechanisms
  - Connection status indicators
  - Sync conflict resolution

**Deliverables**:
- ✅ Optimized bundle size and rendering performance
- ✅ Enhanced accessibility and mobile support
- ✅ Advanced features (shortcuts, export/import)
- ✅ Robust error handling and resilience
- ✅ Production-ready performance metrics

---

### Phase 6: Documentation & Finalization (Week 6-7)
**Objective**: Complete documentation, testing, and deployment preparation

#### 6.1 Developer Documentation
- **Technical Architecture Guide**:
  - Component interaction diagrams
  - State flow documentation
  - API reference and examples
  - Extension points for customization
- **Code Documentation**:
  - Comprehensive JSDoc comments
  - Type definitions with examples
  - Architecture decision records (ADRs)
  - Performance optimization notes
- **Development Setup Guide**:
  - Environment configuration
  - Build and deployment processes
  - Debugging and troubleshooting
  - Contributing guidelines

#### 6.2 User Documentation
- **Feature Guides**:
  - Getting started with Composer Mode
  - Drag-and-drop composition tutorial
  - Refinement tools usage guide
  - Export and sharing options
- **Best Practices**:
  - Effective composition strategies
  - Refinement workflow recommendations
  - Performance tips for large documents
  - Collaboration and sharing guidelines
- **Troubleshooting**:
  - Common issues and solutions
  - Performance troubleshooting
  - Data recovery procedures
  - Support contact information

#### 6.3 Quality Assurance
- **Comprehensive Testing Suite**:
  ```typescript
  // Unit tests for core utilities
  describe('Composer Utilities', () => {
    test('parseIntoGranularUnits handles edge cases', () => {
      // Test empty content, special characters, etc.
    });
    
    test('sourceMapping tracks provenance correctly', () => {
      // Test mapping accuracy and persistence
    });
  });
  
  // Integration tests for workflows
  describe('Composer Workflows', () => {
    test('complete composition workflow', async () => {
      // End-to-end test of drag-drop-refine-export
    });
  });
  ```
- **Cross-browser Testing**:
  - Chrome, Firefox, Safari, Edge compatibility
  - Different screen sizes and resolutions
  - Various input methods (mouse, touch, keyboard)
- **Performance Testing**:
  - Large document handling
  - Memory usage optimization
  - Network request efficiency
  - Battery usage on mobile devices

#### 6.4 Deployment Preparation
- **Production Build Optimization**:
  - Minification and compression
  - Source map generation for debugging
  - Environment-specific configurations
  - Security hardening
- **Release Management**:
  - Version numbering and changelog
  - Feature flag configuration
  - Rollback procedures
  - Monitoring and analytics setup
- **User Migration**:
  - Data migration scripts
  - Feature announcement and onboarding
  - Feedback collection mechanisms
  - Support documentation updates

**Deliverables**:
- ✅ Complete technical and user documentation
- ✅ Comprehensive test suite with high coverage
- ✅ Cross-browser compatibility verified
- ✅ Production-ready build and deployment process
- ✅ User migration and support systems ready

---

## 9. Technical Implementation Details

### 9.1 Architecture Patterns

#### Component Architecture
```typescript
// Composer Context Provider
interface ComposerContextValue {
  state: ComposerState;
  dispatch: React.Dispatch<ComposerAction>;
  services: {
    persistence: ComposerPersistence;
    refinement: RefinementService;
    export: ExportService;
  };
}

// Main Composer Container
const ComposerMode: React.FC<ComposerModeProps> = ({ sessionId, aiTurnId }) => {
  const [state, dispatch] = useReducer(composerReducer, initialState);
  const services = useMemo(() => createComposerServices(), []);
  
  return (
    <ComposerContext.Provider value={{ state, dispatch, services }}>
      <div className="composer-layout">
        <ComposerToolbar />
        <div className="composer-main">
          <SourcePanel />
          <CanvasEditor />
        </div>
        <ComposerStatusBar />
      </div>
    </ComposerContext.Provider>
  );
};
```

#### State Management Pattern
```typescript
// Composer State Reducer
type ComposerAction = 
  | { type: 'SET_CANVAS_CONTENT'; payload: SlateDescendant[] }
  | { type: 'ADD_SOURCE_MAPPING'; payload: ContentSourceMap }
  | { type: 'UPDATE_GRANULARITY'; payload: GranularityLevel }
  | { type: 'ADD_REFINEMENT_ENTRY'; payload: RefinementEntry }
  | { type: 'SET_DIRTY_STATE'; payload: boolean };

const composerReducer = (state: ComposerState, action: ComposerAction): ComposerState => {
  switch (action.type) {
    case 'SET_CANVAS_CONTENT':
      return {
        ...state,
        canvasContent: action.payload,
        isDirty: true,
        lastModified: Date.now()
      };
    // ... other cases
  }
};
```

### 9.2 Performance Optimization Strategies

#### Virtual Scrolling Implementation
```typescript
// Optimized Source Panel with Virtualization
const VirtualizedSourcePanel: React.FC<SourcePanelProps> = ({ sources }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  
  const virtualizer = useVirtualizer({
    count: sources.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback((index) => {
      // Dynamic sizing based on content length
      const source = sources[index];
      return Math.max(80, Math.min(200, source.content.length / 10));
    }, [sources]),
    overscan: 3
  });
  
  return (
    <div ref={containerRef} className="source-panel-virtual">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <VirtualSourceItem
            key={virtualRow.key}
            virtualRow={virtualRow}
            source={sources[virtualRow.index]}
          />
        ))}
      </div>
    </div>
  );
};
```

#### Drag Performance Optimization
```typescript
// Optimized Drag Handler with RAF
const useDragOptimization = () => {
  const rafRef = useRef<number>();
  
  const optimizedDragHandler = useCallback((event: DragEvent) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    
    rafRef.current = requestAnimationFrame(() => {
      // Batch DOM updates
      updateDragPreview(event.clientX, event.clientY);
      updateDropZoneHighlights(event.target);
    });
  }, []);
  
  return { optimizedDragHandler };
};
```

### 9.3 Security & Privacy Considerations

#### Content Sanitization
```typescript
// Secure content handling
const sanitizeComposerContent = (content: SlateDescendant[]): SlateDescendant[] => {
  return content.map(node => {
    if (Element.isElement(node)) {
      // Remove potentially dangerous attributes
      const { children, ...safeProps } = node;
      return {
        ...safeProps,
        children: sanitizeComposerContent(children)
      };
    }
    return node;
  });
};
```

#### Data Privacy Protection
```typescript
// Privacy-preserving persistence
const encryptComposerState = async (state: ComposerState): Promise<string> => {
  // Use Web Crypto API for client-side encryption
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: crypto.getRandomValues(new Uint8Array(12)) },
    key,
    new TextEncoder().encode(JSON.stringify(state))
  );
  
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
};
```

---

## 10. Integration Points & Dependencies

### 10.1 Extension API Integration
```typescript
// Service Worker Integration
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'executeComposerRefinement') {
    handleComposerRefinement(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  }
});

// Content Script Bridge
const composerBridge = {
  async refineContent(content: string, options: RefinementOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'executeComposerRefinement',
        payload: { content, options }
      }, (response) => {
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error));
        }
      });
    });
  }
};
```

### 10.2 Storage Integration
```typescript
// Chrome Extension Storage API
const composerStorage = {
  async save(key: string, data: ComposerState): Promise<void> {
    const serialized = await serializeComposerState(data);
    await chrome.storage.local.set({ [key]: serialized });
  },
  
  async load(key: string): Promise<ComposerState | null> {
    const result = await chrome.storage.local.get(key);
    if (result[key]) {
      return deserializeComposerState(result[key]);
    }
    return null;
  },
  
  async clear(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
};
```

---

## 11. Testing Strategy & Quality Assurance

### 11.1 Unit Testing Framework
```typescript
// Jest + React Testing Library Setup
describe('Composer Core Functionality', () => {
  describe('Content Parsing', () => {
    test('parseIntoGranularUnits - paragraph level', () => {
      const content = "First paragraph.\n\nSecond paragraph with more content.";
      const result = parseIntoGranularUnits(content, 'paragraph');
      
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("First paragraph.");
      expect(result[1].text).toBe("Second paragraph with more content.");
    });
    
    test('parseIntoGranularUnits - sentence level', () => {
      const content = "First sentence. Second sentence! Third question?";
      const result = parseIntoGranularUnits(content, 'sentence');
      
      expect(result).toHaveLength(3);
      expect(result[0].text).toBe("First sentence.");
      expect(result[1].text).toBe("Second sentence!");
      expect(result[2].text).toBe("Third question?");
    });
  });
  
  describe('Source Mapping', () => {
    test('maintains provenance through drag operations', () => {
      const sourceMap = createSourceMap();
      const draggedContent = { id: 'test-1', text: 'Test content' };
      
      const updatedMap = updateSourceMapping(sourceMap, draggedContent, {
        providerId: 'claude',
        originalIndex: 0,
        granularity: 'paragraph'
      });
      
      expect(updatedMap['test-1']).toBeDefined();
      expect(updatedMap['test-1'].providerId).toBe('claude');
    });
  });
});
```

### 11.2 Integration Testing
```typescript
// End-to-End Workflow Testing
describe('Composer Workflow Integration', () => {
  test('complete composition workflow', async () => {
    const { getByTestId, getByText } = render(
      <ComposerMode sessionId="test-session" aiTurnId="test-turn" />
    );
    
    // 1. Load AI responses in source panel
    await waitFor(() => {
      expect(getByTestId('source-panel')).toBeInTheDocument();
    });
    
    // 2. Drag content to canvas
    const draggableItem = getByTestId('draggable-content-0');
    const canvas = getByTestId('canvas-editor');
    
    fireEvent.dragStart(draggableItem);
    fireEvent.dragOver(canvas);
    fireEvent.drop(canvas);
    
    // 3. Verify content appears in canvas
    await waitFor(() => {
      expect(canvas).toHaveTextContent('Expected content');
    });
    
    // 4. Trigger refinement
    const refineButton = getByText('Refine');
    fireEvent.click(refineButton);
    
    // 5. Verify refinement completes
    await waitFor(() => {
      expect(getByTestId('refinement-result')).toBeInTheDocument();
    });
  });
});
```

### 11.3 Performance Testing
```typescript
// Performance Benchmarks
describe('Composer Performance', () => {
  test('handles large source lists efficiently', async () => {
    const largeSources = Array.from({ length: 1000 }, (_, i) => ({
      id: `source-${i}`,
      content: `Content ${i}`.repeat(100),
      providerId: 'test'
    }));
    
    const startTime = performance.now();
    
    const { getByTestId } = render(
      <SourcePanel sources={largeSources} />
    );
    
    const endTime = performance.now();
    const renderTime = endTime - startTime;
    
    expect(renderTime).toBeLessThan(100); // Should render in under 100ms
    expect(getByTestId('source-panel')).toBeInTheDocument();
  });
  
  test('drag operations remain responsive', async () => {
    // Test drag performance with timing constraints
    const dragStartTime = performance.now();
    
    // Simulate drag operation
    await simulateDragOperation();
    
    const dragEndTime = performance.now();
    expect(dragEndTime - dragStartTime).toBeLessThan(16); // 60fps target
  });
});
```

---

## 12. Deployment & Release Strategy

### 12.1 Feature Flag Implementation
```typescript
// Feature Flag System
interface FeatureFlags {
  composerMode: boolean;
  advancedRefinement: boolean;
  batchOperations: boolean;
  cloudSync: boolean;
}

const useFeatureFlags = (): FeatureFlags => {
  const [flags, setFlags] = useState<FeatureFlags>({
    composerMode: false,
    advancedRefinement: false,
    batchOperations: false,
    cloudSync: false
  });
  
  useEffect(() => {
    // Load flags from storage or remote config
    loadFeatureFlags().then(setFlags);
  }, []);
  
  return flags;
};

// Conditional Rendering
const App: React.FC = () => {
  const flags = useFeatureFlags();
  
  return (
    <div className="app">
      {flags.composerMode && <ComposerModeButton />}
      {/* Other conditional features */}
    </div>
  );
};
```

### 12.2 Gradual Rollout Plan
```typescript
// Progressive Enhancement Strategy
const ROLLOUT_PHASES = {
  PHASE_1: {
    percentage: 5,
    features: ['basicComposer', 'dragDrop'],
    criteria: 'internal_users'
  },
  PHASE_2: {
    percentage: 25,
    features: ['basicComposer', 'dragDrop', 'basicRefinement'],
    criteria: 'beta_users'
  },
  PHASE_3: {
    percentage: 100,
    features: ['all'],
    criteria: 'all_users'
  }
};
```

### 12.3 Monitoring & Analytics
```typescript
// Usage Analytics
const trackComposerUsage = (event: string, properties?: Record<string, any>) => {
  // Privacy-preserving analytics
  const anonymizedData = {
    event,
    timestamp: Date.now(),
    sessionId: generateAnonymousId(),
    ...properties
  };
  
  // Send to analytics service
  sendAnalytics(anonymizedData);
};

// Performance Monitoring
const performanceMonitor = {
  trackRenderTime: (component: string, duration: number) => {
    if (duration > 100) { // Alert on slow renders
      console.warn(`Slow render detected: ${component} took ${duration}ms`);
    }
  },
  
  trackMemoryUsage: () => {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      if (memory.usedJSHeapSize > 50 * 1024 * 1024) { // 50MB threshold
        console.warn('High memory usage detected');
      }
    }
  }
};
```

---

### MVP Scope
**Core Features for Initial Release:**

1. **Foundation Components**
   - Basic composer mode toggle in main UI
   - Source panel displaying AI outputs (synthesis, ensemble, batch)
   - Canvas editor with Slate.js integration
   - Simple drag-and-drop from sources to canvas

2. **Essential Functionality**
   - Granularity controls (full response, paragraph, sentence)
   - Basic content composition and editing
   - Source attribution and provenance tracking
   - Auto-save with local storage persistence

3. **Minimum Refinement Features**
   - Basic text refinement API integration
   - Simple refinement controls (grammar, style, tone)
   - Refinement history with undo/redo

4. **Export Capabilities**
   - Copy to clipboard functionality
   - Basic markdown export
   - Simple sharing options

**Excluded from MVP:**
- Advanced refinement features (batch operations, custom rules)
- Cloud synchronization
- Advanced export formats (PDF, DOCX)
- Mobile optimization
- Collaborative features

---

## 13. Risk Assessment & Mitigation

### 13.1 Technical Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|---------|-------------|-------------------|
| **Slate.js Performance Issues** | High | Medium | Implement virtual scrolling, content chunking, and performance monitoring |
| **Drag-and-Drop Browser Compatibility** | Medium | Low | Use @dnd-kit library, extensive cross-browser testing |
| **Memory Leaks with Large Content** | High | Medium | Implement proper cleanup, memory monitoring, content pagination |
| **Extension Storage Limits** | Medium | Medium | Implement data compression, cleanup policies, cloud backup preparation |

### 13.2 User Experience Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|---------|-------------|-------------------|
| **Complex UI Overwhelming Users** | High | High | Progressive disclosure, onboarding flow, feature flags |
| **Performance Degradation** | High | Medium | Performance budgets, monitoring, optimization |
| **Data Loss During Composition** | Critical | Low | Robust auto-save, recovery mechanisms, backup strategies |
| **Learning Curve Too Steep** | Medium | Medium | Intuitive design, tutorials, contextual help |

### 13.3 Business Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|---------|-------------|-------------------|
| **Low User Adoption** | High | Medium | User research, beta testing, iterative improvements |
| **Feature Scope Creep** | Medium | High | Strict MVP definition, phased rollout, stakeholder alignment |
| **Development Timeline Overrun** | Medium | Medium | Agile methodology, regular checkpoints, scope adjustment |

---

## 14. Success Metrics & KPIs

### 14.1 Technical Metrics
- **Performance**: Canvas render time < 100ms, drag operations < 16ms
- **Reliability**: 99.9% uptime, < 0.1% data loss incidents
- **Scalability**: Support for 1000+ source items, 10MB+ compositions
- **Compatibility**: 95%+ compatibility across Chrome, Firefox, Safari, Edge

### 14.2 User Experience Metrics
- **Adoption Rate**: 25% of active users try composer mode within 30 days
- **Engagement**: 60% of users who try composer complete a full workflow
- **Retention**: 40% of composer users return within 7 days
- **Satisfaction**: 4.0+ average rating in user feedback

### 14.3 Feature Usage Metrics
- **Drag-and-Drop**: 80% of compositions use drag-and-drop
- **Refinement**: 50% of compositions use refinement features
- **Export**: 70% of completed compositions are exported
- **Granularity**: Even distribution across granularity levels

---

## 15. Future Enhancements & Roadmap

### 15.1 Phase 7: Advanced Features (Month 2-3)
- **Collaborative Composition**: Real-time collaboration, shared workspaces
- **AI-Powered Suggestions**: Smart content recommendations, auto-completion
- **Template System**: Reusable composition templates, style guides
- **Advanced Export**: PDF generation, custom formatting, batch export

### 15.2 Phase 8: Enterprise Features (Month 3-4)
- **Team Management**: User roles, permissions, workspace sharing
- **Brand Compliance**: Style guide enforcement, brand voice consistency
- **Audit Trail**: Comprehensive change tracking, compliance reporting
- **API Integration**: Third-party tool integration, webhook support

### 15.3 Phase 9: AI Enhancement (Month 4-5)
- **Smart Composition**: AI-suggested content organization
- **Context-Aware Refinement**: Domain-specific improvement suggestions
- **Automated Quality Checks**: Grammar, fact-checking, citation validation
- **Personalized Workflows**: User behavior-based feature customization

### 15.4 Long-term Vision (6+ Months)
- **Multi-modal Composition**: Image, video, and audio content integration
- **Cross-platform Sync**: Mobile app, web app, desktop integration
- **Advanced Analytics**: Composition performance metrics, user insights
- **AI Model Training**: Custom model fine-tuning based on user preferences

---

## 16. Conclusion

This comprehensive development plan provides a structured approach to implementing Composer Mode in the Hybrid Thinking Sidecar OS. The phased approach ensures:

1. **Solid Foundation**: Robust architecture and type system
2. **Core Functionality**: Essential drag-and-drop composition workflow
3. **AI Integration**: Powerful refinement and improvement capabilities
4. **Production Readiness**: Performance optimization, testing, and deployment
5. **Future Scalability**: Extensible design for advanced features

The plan balances ambitious functionality with practical implementation constraints, ensuring a successful rollout that delivers immediate value while laying the groundwork for future enhancements.

**Key Success Factors:**
- Adherence to the phased timeline and deliverables
- Continuous user feedback integration
- Performance monitoring and optimization
- Comprehensive testing at each phase
- Clear communication with stakeholders

**Next Steps:**
1. Review and approve the development plan
2. Set up development environment and dependencies
3. Begin Phase 1 implementation
4. Establish regular progress review meetings
5. Prepare user research and testing protocols

This plan serves as a living document that should be updated based on implementation learnings, user feedback, and changing requirements throughout the development process.

## Testing Strategy

### Unit Tests
```typescript
// Test granular parsing
describe('parseIntoGranularUnits', () => {
  it('should split paragraphs correctly', () => {
    const content = 'Para 1.\n\nPara 2.';
    const units = parseIntoGranularUnits(content, 'paragraph');
    expect(units).toHaveLength(2);
  });
});

// Test source mapping
describe('ContentSourceMap', () => {
  it('should track dragged content origins', () => {
    const mapping = new ContentSourceMap();
    mapping.add(nodeId, { providerId: 'gpt-4', originalIndex: 0 });
    expect(mapping.get(nodeId).providerId).toBe('gpt-4');
  });
});
```

### Integration Tests
```typescript
// Test drag-and-drop flow
describe('Composer drag-and-drop', () => {
  it('should insert content at drop position', async () => {
    const { getByTestId } = render(<ComposerMode aiTurn={mockAiTurn} />);
    
    const draggable = getByTestId('draggable-content-0');
    const dropZone = getByTestId('editor-drop-zone');
    
    fireEvent.dragStart(draggable);
    fireEvent.drop(dropZone);
    
    expect(getByTestId('editor-content')).toContainText(expectedText);
  });
});
```

## Potential Challenges & Solutions

### Challenge 1: Performance with Large Responses
**Solution**: Implement virtualization for source panel, lazy-load content, use React.memo for expensive components

### Challenge 2: Complex Slate State Management
**Solution**: Create custom Slate plugins, maintain normalized document structure, implement robust error boundaries

### Challenge 3: Cross-Provider Content Formatting
**Solution**: Normalize all content to markdown internally, convert on display/export

### Challenge 4: Refinement Context Limits
**Solution**: Implement smart truncation, prioritize recently composed content, use sliding window approach

### Challenge 5: State Synchronization
**Solution**: Use single source of truth (AiTurn), implement optimistic updates with rollback, add conflict resolution

This comprehensive plan provides the technical foundation for implementing Composer Mode while maintaining compatibility with the existing extension architecture.