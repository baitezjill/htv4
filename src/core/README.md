# HTOS Core DNR Utilities

This directory contains core utilities for managing Chrome's Declarative Net Request (DNR) API within the HTOS extension, inspired by HARPA's approach to network rule management.

## Overview

The DNR utilities provide a robust, session-aware system for managing network request modifications, particularly for Arkose Enforcement (AE) header injection. The system handles service worker restarts, rule persistence, and provides debugging capabilities.

## Architecture

### Key Components

- **`dnr-utils.js`** - Core DNR utility class with header modification methods
- **`NetRulesManager.js`** - High-level network rules management with ArkoseController
- **`dnr-auditor.js`** - Debugging and audit functionality

### Design Principles

1. **DNR First** - All network modifications use declarative rules, not runtime interception
2. **Session Persistence** - Rules survive service worker restarts via chrome.storage.local
3. **Provider Scoping** - Rules are tagged by provider (chatgpt, claude, etc.) for easy cleanup
4. **Temporary Rules** - Support for time-limited rules with automatic cleanup
5. **Debug Support** - Built-in debugging via chrome.declarativeNetRequest.onRuleMatchedDebug

## API Reference

### DNRUtils Class

#### Static Methods

##### `initialize()`
Initializes the DNR utility system and restores persisted rules.

```javascript
await DNRUtils.initialize();
```

##### `registerHeaderRule(options)`
Registers a header modification rule with comprehensive options.

**Parameters:**
- `options.urlFilter` (string) - URL pattern to match (required)
- `options.headers` (object) - Headers to add/modify (required)
- `options.provider` (string) - Provider identifier for scoping
- `options.tabId` (number) - Limit rule to specific tab
- `options.duration` (number) - Auto-expire after milliseconds
- `options.priority` (number) - Rule priority (default: 1)
- `options.resourceTypes` (array) - Resource types to match (default: ['xmlhttprequest'])

**Returns:** Promise<string> - Rule ID

```javascript
const ruleId = await DNRUtils.registerHeaderRule({
  urlFilter: 'https://chatgpt.com/*',
  headers: {
    'Openai-Sentinel-Chat-Requirements-Token': 'token123',
    'Openai-Sentinel-Proof-Token': 'proof456'
  },
  provider: 'chatgpt',
  duration: 300000 // 5 minutes
});
```

##### `registerTemporaryHeaderRule(options, duration)`
Convenience method for temporary header rules.

```javascript
const ruleId = await DNRUtils.registerTemporaryHeaderRule({
  urlFilter: 'https://claude.ai/*',
  headers: { 'Authorization': 'Bearer token' },
  provider: 'claude'
}, 60000); // 1 minute
```

##### `removeRule(ruleId)`
Removes a specific rule by ID.

```javascript
await DNRUtils.removeRule(ruleId);
```

##### `removeProviderRules(provider)`
Removes all rules associated with a provider.

```javascript
await DNRUtils.removeProviderRules('chatgpt');
```

##### `getActiveRules()`
Retrieves all active rules (dynamic and session).

```javascript
const rules = await DNRUtils.getActiveRules();
console.log('Active rules:', rules);
```

#### Debug Methods

##### `enableDebugMode()`
Enables debug logging for rule matches.

```javascript
DNRUtils.enableDebugMode();
```

##### `disableDebugMode()`
Disables debug logging.

```javascript
DNRUtils.disableDebugMode();
```

#### Cleanup Methods

##### `startPeriodicCleanup(intervalMs)`
Starts automatic cleanup of expired rules.

```javascript
DNRUtils.startPeriodicCleanup(60000); // Check every minute
```

##### `stopPeriodicCleanup()`
Stops automatic cleanup.

```javascript
DNRUtils.stopPeriodicCleanup();
```

### ArkoseController (NetRulesManager.js)

#### Methods

##### `injectAEHeaders(options)`
High-level method for AE header injection.

**Parameters:**
- `options.urlFilter` (string) - URL pattern to match
- `options.headers` (object) - AE headers to inject
- `options.provider` (string) - Provider identifier
- `options.duration` (number) - Rule duration in milliseconds

```javascript
await ArkoseController.injectAEHeaders({
  urlFilter: 'https://chatgpt.com/*',
  headers: {
    'Openai-Sentinel-Chat-Requirements-Token': sentinelToken,
    'Openai-Sentinel-Proof-Token': powToken,
    'Openai-Sentinel-Arkose-Token': arkoseToken
  },
  provider: 'chatgpt',
  duration: 300000
});
```

##### `removeAEHeaderRule(ruleId)`
Removes a specific AE header rule.

```javascript
await ArkoseController.removeAEHeaderRule(ruleId);
```

##### `removeAllAEHeaderRules(provider)`
Removes all AE header rules for a provider.

```javascript
await ArkoseController.removeAllAEHeaderRules('chatgpt');
```

## Usage Examples

### Basic Header Injection

```javascript
import { DNRUtils } from './dnr-utils.js';

// Initialize the system
await DNRUtils.initialize();

// Inject authentication headers
const ruleId = await DNRUtils.registerHeaderRule({
  urlFilter: 'https://api.example.com/*',
  headers: {
    'Authorization': 'Bearer ' + token,
    'X-API-Key': apiKey
  },
  provider: 'example-provider',
  duration: 3600000 // 1 hour
});

// Later, remove the rule
await DNRUtils.removeRule(ruleId);
```

### Provider-Scoped Management

```javascript
// Add multiple rules for a provider
const rule1 = await DNRUtils.registerHeaderRule({
  urlFilter: 'https://chatgpt.com/backend-api/*',
  headers: { 'X-Custom-Header': 'value1' },
  provider: 'chatgpt'
});

const rule2 = await DNRUtils.registerHeaderRule({
  urlFilter: 'https://chatgpt.com/api/*',
  headers: { 'X-Another-Header': 'value2' },
  provider: 'chatgpt'
});

// Remove all rules for the provider at once
await DNRUtils.removeProviderRules('chatgpt');
```

### Tab-Specific Rules

```javascript
// Inject headers only for a specific tab
const ruleId = await DNRUtils.registerHeaderRule({
  urlFilter: 'https://example.com/*',
  headers: { 'X-Tab-Specific': 'true' },
  tabId: 123,
  provider: 'tab-provider'
});
```

### Debugging

```javascript
// Enable debug mode to see rule matches
DNRUtils.enableDebugMode();

// Register a rule
const ruleId = await DNRUtils.registerHeaderRule({
  urlFilter: 'https://debug.example.com/*',
  headers: { 'X-Debug': 'enabled' },
  provider: 'debug-provider'
});

// Check console for debug output when requests match
// Disable when done
DNRUtils.disableDebugMode();
```

### Automatic Cleanup

```javascript
// Start periodic cleanup (recommended in service worker)
DNRUtils.startPeriodicCleanup(300000); // Check every 5 minutes

// Register temporary rules that will be cleaned up automatically
const ruleId = await DNRUtils.registerTemporaryHeaderRule({
  urlFilter: 'https://temp.example.com/*',
  headers: { 'X-Temporary': 'true' },
  provider: 'temp-provider'
}, 60000); // Expires in 1 minute
```

## Integration with Providers

### ChatGPT Provider Example

```javascript
// In chatgpt.js
import { ArkoseController } from '../HTOS/NetRulesManager.js';

class ChatGPTSessionApi {
  async _injectAEHeaders(headers, requirements) {
    // Prepare headers for DNR injection
    const headersToInject = {};
    
    // Add sentinel token
    if (sentinelToken) {
      headersToInject['Openai-Sentinel-Chat-Requirements-Token'] = sentinelToken;
    }
    
    // Add PoW token
    if (powToken) {
      headersToInject['Openai-Sentinel-Proof-Token'] = powToken;
    }
    
    // Add Arkose token
    if (arkoseToken) {
      headersToInject['Openai-Sentinel-Arkose-Token'] = arkoseToken;
    }
    
    // Inject via DNR
    if (Object.keys(headersToInject).length > 0) {
      await ArkoseController.injectAEHeaders({
        urlFilter: 'https://chatgpt.com/*',
        headers: headersToInject,
        provider: 'chatgpt',
        duration: 300000 // 5 minutes
      });
    }
    
    return headers;
  }
}
```

## Error Handling

The DNR utilities include comprehensive error handling:

```javascript
try {
  await DNRUtils.registerHeaderRule({
    urlFilter: 'invalid-url',
    headers: { 'X-Test': 'value' }
  });
} catch (error) {
  console.error('DNR rule registration failed:', error);
  // Handle error appropriately
}
```

## Best Practices

1. **Initialize Early** - Call `DNRUtils.initialize()` in your service worker startup
2. **Use Provider Scoping** - Always specify a provider for easy cleanup
3. **Set Reasonable Durations** - Don't create permanent rules unless necessary
4. **Enable Cleanup** - Use `startPeriodicCleanup()` to prevent rule accumulation
5. **Debug Sparingly** - Only enable debug mode during development
6. **Handle Errors** - Wrap DNR calls in try-catch blocks
7. **Clean Up** - Remove provider rules when switching contexts

## Troubleshooting

### Common Issues

1. **Rules Not Applying**
   - Check URL filter patterns
   - Verify resource types match
   - Enable debug mode to see rule matches

2. **Service Worker Restart Issues**
   - Ensure `initialize()` is called on startup
   - Check chrome.storage.local permissions

3. **Rule Limit Exceeded**
   - Use `removeProviderRules()` to clean up
   - Enable periodic cleanup
   - Check rule count with `getActiveRules()`

### Debug Commands

```javascript
// Check active rules
const rules = await DNRUtils.getActiveRules();
console.log('Active rules:', rules.length);

// Enable debug logging
DNRUtils.enableDebugMode();

// Check persisted rules
const stored = await chrome.storage.local.get(DNRUtils.STORAGE_KEY);
console.log('Stored rules:', stored);
```

## Migration Notes

When migrating from direct header modification to DNR:

1. Replace direct `headers[name] = value` assignments
2. Use `registerHeaderRule()` instead
3. Add provider scoping for cleanup
4. Consider rule duration for temporary headers
5. Update error handling for async operations

## Performance Considerations

- DNR rules are processed by Chrome's network stack (faster than content scripts)
- Rule registration is async but rule application is immediate
- Periodic cleanup prevents rule accumulation
- Session rules are faster than dynamic rules for temporary use

## Security Notes

- Rules are scoped to extension permissions
- Headers are validated by Chrome's DNR implementation
- No direct access to request/response bodies
- Rules persist across service worker restarts (by design)