// Public surface of the transport-agnostic turn engine. See ./types for the
// contract and docs/phase-5-plan.md for why it exists.
export { runTurn } from "./flow";
export { textAI, textPersistence } from "./text-runtime";
export {
  type AIPort,
  type ConversationSnapshot,
  type PersistencePort,
  type SnapshotMessage,
  type Turn,
  TurnCollisionError,
  type TurnInput,
  type TurnOutcome,
} from "./types";
