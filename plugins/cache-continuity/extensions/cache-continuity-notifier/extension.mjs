import { joinSession } from '@github/copilot-sdk/extension';
import {
  createCacheTurnObserver,
  createTurnEntryGate,
  formatCacheTurn,
} from '../../lib/cache-continuity.mjs';

const cacheTurns = createCacheTurnObserver();
const turnEntry = createTurnEntryGate();

const session = await joinSession({});
await session.log('Cache continuity notifier active.');

session.on('assistant.turn_start', (event) => {
  turnEntry.start(event.agentId);
});

session.on('assistant.usage', async (event) => {
  const data = event.data ?? {};
  const isMainAgent =
    event.agentId == null &&
    data.initiator !== 'sub-agent' &&
    data.initiator !== 'mcp-sampling' &&
    data.parentToolCallId == null;

  // Usage may arrive after assistant.turn_end, so only an eligible usage event
  // closes the turn-entry slot.
  if (!turnEntry.take(isMainAgent)) return;

  await session.log(formatCacheTurn(cacheTurns.observe(data)), { level: 'info' });
});
