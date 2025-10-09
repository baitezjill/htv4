# Gemini Code Assistant Context

This document provides context for the Gemini Code Assistant to understand the HybridThinkingv3 project.

## Project Overview

HybridThinkingv3 is a sophisticated Chrome extension that functions as a multi-modal AI assistant. It allows users to send a single prompt to multiple AI providers (such as Claude, Gemini, ChatGPT, and Qwen) simultaneously and then synthesizes the results into a single, coherent answer. The extension is built with a modern web stack, including React for the UI, TypeScript for type safety, and esbuild for fast bundling.

## Architecture

The extension follows a modular architecture that separates concerns between the user interface, the core logic, and the AI provider interactions.

### UI (`ui/`)

The user interface is a complex React application that provides a rich user experience. Key features include:

*   **Chat Interface:** A familiar chat interface for sending prompts and viewing results.
*   **Composer Mode:** A more advanced interface for constructing complex workflows.
*   **History Panel:** Allows users to view and manage their conversation history.
*   **Model Tray:** A tray for selecting which AI models to use for a given prompt.
*   **Real-time Streaming:** The UI streams results from the AI providers in real-time.

### Core (`src/core/`)

The core of the extension is responsible for managing the application's lifecycle, handling workflows, and orchestrating AI providers.

*   **Workflow Engine (`workflow-engine.js`):** This is the heart of the extension. It receives declarative workflows from the UI, executes the steps in the correct order, and streams the results back to the UI.
*   **Request Lifecycle Manager (`request-lifecycle-manager.js`):** Manages the lifecycle of requests to the AI providers.
*   **Session Manager:** Manages conversation history and provider contexts.

### Providers (`src/providers/`)

Each AI provider has its own adapter that conforms to a common interface. This makes it easy to add new providers in the future.

*   **Adapters:** Each adapter is responsible for sending prompts to the provider's API and parsing the results.
*   **Controllers:** Each provider has a controller that manages the provider-specific logic, such as handling authentication and API-specific features.

### Shared (`shared/`)

This directory contains the data contracts and types that are shared between the UI and the background scripts. This ensures that the different parts of the extension can communicate with each other in a type-safe way.

## Data Flow

The data flow in HybridThinkingv3 is designed to be robust and flexible. It is centered around the concept of **workflows**.

1.  **Workflow Construction:** The user interacts with the UI to create a prompt. The UI then uses the `WorkflowBuilder` to construct a declarative workflow that specifies the steps to be executed.
2.  **Workflow Execution:** The UI sends the workflow to the `WorkflowEngine` in the background script.
3.  **Step Execution:** The `WorkflowEngine` executes the steps in the workflow. This may involve sending prompts to multiple AI providers in parallel.
4.  **Orchestration:** The `Orchestrator` fans out the requests to the different AI providers and manages the results.
5.  **Streaming:** The results from the AI providers are streamed back to the UI in real-time.
6.  **Synthesis and Ensemble:** The `WorkflowEngine` can also execute synthesis and ensemble steps, which use AI to combine the results from multiple providers into a single answer.

## Building and Running

*   **Build:** `npm run build`
    *   This command uses `esbuild` to bundle the service worker, content scripts, and UI components into the `dist/` directory.
*   **Watch:** `npm run watch`
    *   This command will watch for file changes and automatically rebuild the extension.
*   **Clean:** `npm run clean`
    *   This command removes the `dist/` directory.
*   **Test:** `npm test`
    *   This command runs tests using `jest`.

## Development Conventions

*   **Code Style:** The code is written in JavaScript and TypeScript. It uses modules and follows modern JavaScript conventions.
*   **Testing:** The project uses `jest` for testing.
*   **Dependencies:** The project uses `npm` to manage dependencies.
*   **Build System:** The project uses `esbuild` for building and bundling.