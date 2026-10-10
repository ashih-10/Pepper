// STUB — replaced by the local-backend agent (signatures are the contract).
export interface LocalSession {
  userId: string;
}

/** The demo "signed-in" student on this device, or null before the demo starts. */
export function getLocalSession(): LocalSession | null {
  return null;
}

/** Start the demo: creates the on-device student, Jordan and the sample group. */
export function startLocalSession(): LocalSession {
  throw new Error('not implemented');
}

/** Leave the demo and erase everything it stored on this device. */
export function endLocalSession(): void {}

/** Called whenever the demo session starts or ends. Returns an unsubscribe function. */
export function onLocalSessionChange(_cb: (s: LocalSession | null) => void): () => void {
  return () => {};
}
