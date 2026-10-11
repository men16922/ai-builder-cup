import { useEffect, useRef } from 'react';

/** Custom elements dispatch DOM events that React's synthetic system does not map, so listeners are attached explicitly. */
export function useElementEvent<T extends Event>(name: string, handler: ((event: T) => void) | undefined) {
  const element = useRef<HTMLElement>(null), latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const node = element.current; if (!node) return;
    const listener = (event: Event) => latest.current?.(event as T);
    node.addEventListener(name, listener); return () => node.removeEventListener(name, listener);
  }, [name]);
  return element;
}
