
Step 2: Create the "Clip" UI in AiTurnBlock.tsx
This component will now manage which "take" is active and display it.
code
TypeScript
// Conceptual code for AiTurnBlock.tsx

import { useState } from 'react';
// ... other imports

const AiTurnBlock = ({ aiTurn, onRunSynthesis, onRunEnsemble }) => {
  // State to track which take is active for synthesis
  const [activeSynth, setActiveSynth] = useState<{ providerId: string; index: number } | null>(null);
  
  // Logic to get all available synthesis takes
  const allSynthTakes = Object.entries(aiTurn.synthesisResponses || {}).flatMap(
    ([providerId, responses]) => responses.map((response, index) => ({
      providerId,
      index,
      response,
      label: `${providerId} #${index + 1}`
    }))
  );

  // Set the default active synth to the latest one if not already set
  if (!activeSynth && allSynthTakes.length > 0) {
    setActiveSynth({ 
      providerId: allSynthTakes.at(-1)!.providerId, 
      index: allSynthTakes.at(-1)!.index 
    });
  }

  const activeSynthResponse = activeSynth 
    ? aiTurn.synthesisResponses[activeSynth.providerId][activeSynth.index] 
    : null;

  return (
    <div className="ai-turn-block">
      {/* ... Your sticky footer / action bar would live outside this component ... */}

      <div className="main-outputs-container" style={{ display: 'flex', gap: '16px' }}>
        
        {/* Synthesis Side */}
        <div className="synthesis-panel" style={{ flex: 1 }}>
          <div className="clips-track" style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            {allSynthTakes.map(take => (
              <button 
                key={take.label}
                className={activeSynth?.providerId === take.providerId && activeSynth?.index === take.index ? 'active' : ''}
                onClick={() => setActiveSynth({ providerId: take.providerId, index: take.index })}
              >
                {take.label}
              </button>
            ))}
          </div>
          <div className="content-display">
            {activeSynthResponse ? activeSynthResponse.text : "No synthesis available."}
          </div>
        </div>

        {/* Ensemble Side (implement similar logic) */}
        <div className="ensemble-panel" style={{ flex: 1 }}>
          {/* ... Clips track and content display for ensemble ... */}
        </div>

      </div>

      {/* ... Batch Outputs Section Below ... */}
    </div>
  );
};

 Part 1: The "Sticky Footer" Action Bar for In-Context Action
 The solution is to decouple the action bar from the document flow and attach it to the viewport, making it contextually aware.
The Ideal Implementation: The Context-Aware Sticky Bar
Instead of a bar at the top or bottom of the AiTurnBlock, we render a bar that is position: sticky; bottom: 0; (or pinned to the bottom of your chat area). This bar is only visible when a specific AiTurnBlock is scrolled into the user's viewport.
How it Works:
Detection: Use an IntersectionObserver on each AiTurnBlock. When a block enters the viewport (e.g., is 50% visible), it becomes the "active turn."
State Management: A single piece of state in App.tsx, like activeTurnInView: string | null, holds the ID of the active turn. This state is updated by the Intersection Observers.
Rendering: A single TurnActionBar component is rendered at the bottom of the main chat area. It receives activeTurnInView as a prop. If the prop is not null, the bar becomes visible and populates itself with the actions relevant to that turn (passing the userTurnId to its handlers).
Visual Journey:
A user is scrolling through their chat. The action bar is hidden.
They pause on "Turn #3." As AiTurnBlock for Turn #3 becomes the dominant element on screen, the action bar fades in at the bottom of the viewport. It says: Actions for Turn #3: [Show Sources] [🔄 Re-run Synthesis] [🗺️ Re-run ensemble].
They keep scrolling. As Turn #3 leaves the screen and Turn #4 enters, the bar's content instantly updates to Actions for Turn #4: [...].
They scroll to the chat input box at the bottom. The bar fades out to avoid obstructing the input.
Why this is the Superior Solution:
Solves Placement: It's always in the same, predictable, ergonomic location at the bottom of the screen.
Respects Cognitive Flow: It appears after the user has engaged with the content by scrolling to it, perfectly matching the "read, then act" sequence.
Reduces Clutter: It removes all interactive UI from the AiTurnBlock itself, allowing the content to breathe and preserving the clean, conversational transcript aesthetic.
Director's Studio Metaphor: This is exactly how professional editing software works. The timeline is for content; the tool palettes and inspectors are in fixed locations and act upon the selected "clip" (the active turn).


Part 2: "Accordion with Smart Truncation" for Content Display
Now for the content itself. The cardinal rule of good UI is: Avoid nested scrollbars at all costs. "Scroll-ception" is confusing and physically difficult to use. It breaks the main scroll inertia and hides information.
The solution is to let the main page scroll be the one and only scroll, but manage the height of the content blocks intelligently.
The Implementation Strategy:
Default States are Key:
Synthesis & ensemble: Visible by default. These are the primary outputs.
Batch Outputs (Sources): Collapsed by default under a "Show Sources" toggle. This is the raw footage, accessible on demand.
Smart Truncation (The max-height trick):
For the visible-by-default Synthesis and ensemble blocks, don't let them grow infinitely. Apply a CSS max-height (e.g., max-height: 50vh; overflow: hidden;).
Apply a subtle fade-out gradient at the bottom of the container (::after pseudo-element with a linear-gradient) to indicate that there is more content.
Add a "Show More" button. When clicked, this removes the max-height and allows the block to expand to its full natural height.
Exclusive Expansion (Accordion Logic):
To prevent the "mega-scroll" problem where a user expands everything, implement accordion-like behavior.
When the user clicks "Show More" on the Synthesis block, if the ensemble block was already fully expanded, it should collapse back to its truncated max-height state.
The same logic applies when they expand the "Sources" section. This keeps the user focused on one deep-dive at a time, while still allowing easy comparison between the truncated previews of the other sections.
The Cohesive User Journey (Putting it all Together)
Initial View: A user scrolls to a turn. They see the Synthesis and ensemble outputs, each neatly contained in a box about half the screen high, with a "Show More" button if needed. The Batch outputs are hidden under a "Show Sources" toggle. The rest of the screen is clean.
Engagement: They read the truncated Synthesis. It's good, but they want to read it all. They click "Show More," and it smoothly expands to its full height. The ensemble box, if it was also expanded, gracefully collapses back to its truncated preview state.
Decision & Action: After reading the full Synthesis, they decide they want to see Claude's take instead. The Context-Aware Sticky Action Bar is waiting for them at the bottom of the screen. They click "Re-run Synthesis," select Claude from the popover, and the content of the Synthesis box is replaced with a loading shimmer, then streams in the new text.
Deeper Analysis: Now they want to see why Claude wrote that. They click "Show Sources" on the action bar. The main Batch Outputs container expands (collapsing the full Synthesis view back to its preview), showing the three raw model outputs, each in their own truncated max-height container, ready for comparison.