import type { ReactNode } from 'react';

import { isWeb } from '@/lib/storage';
import { isDemo } from '@/lib/supabase';

import { Banner } from './ui';

/** Where the on-device demo keeps its data, for messages to the student. */
export const DEMO_PLACE = isWeb ? 'this browser' : 'this phone';

/**
 * A small note shown only in the on-device demo (no server configured).
 * Without children it says the demo's data never leaves the device.
 */
export function DemoBanner({ children }: { children?: ReactNode }) {
  if (!isDemo) return null;
  return (
    <Banner tone="info" icon={children ? 'bulb-outline' : 'lock-closed-outline'}>
      {children ?? `Demo mode — everything stays in ${DEMO_PLACE}.`}
    </Banner>
  );
}
