// Whether Jev is on (App settings → Jev): it then picks each message's engine and model, and who
// answers in a channel, in Laya's place. Loaded once when the app starts (and again after a save),
// so screens can say "Jev picks" instead of "Laya picks".
import { useEffect, useState } from 'react';

let active = false;
let loading: Promise<boolean> | null = null;
const listeners = new Set<(on: boolean) => void>();

/** Asks the server again (after the Jev settings are saved). */
export function loadJevActive(): Promise<boolean> {
  if (typeof fetch !== 'function') return Promise.resolve(false);
  loading = fetch('/api/settings/jev')
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => !!v?.active)
    .catch(() => false)
    .then((on) => {
      active = on;
      listeners.forEach((l) => l(on));
      return on;
    });
  return loading;
}

/** The last known answer (false until it loads). */
export const jevActive = (): boolean => active;

/** The router's name for "Auto (… picks)". */
export const autoPicker = (): 'Jev' | 'Laya' => (active ? 'Jev' : 'Laya');

/** jevActive() that re-renders the component when it changes. */
export function useJevActive(): boolean {
  const [on, setOn] = useState(active);
  useEffect(() => {
    listeners.add(setOn);
    if (!loading) loadJevActive();
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return on;
}
