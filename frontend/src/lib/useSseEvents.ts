"use client";

import { useEffect, useRef } from "react";

export type SseHandlers = Record<string, (data: any) => void>;

export function useSseEvents(handlers: SseHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const eventNames = () =>
      Object.keys(handlersRef.current).filter((name) => name !== "default");

    const attachListeners = (source: EventSource) => {
      for (const name of eventNames()) {
        source.addEventListener(name, (e) => {
          try {
            const data = JSON.parse((e as MessageEvent).data);
            handlersRef.current[name]?.(data);
          } catch {
            // ignore parse errors
          }
        });
      }
    };

    const connect = () => {
      if (stopped) return;
      try {
        es = new EventSource("/api/events");
        attachListeners(es);
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            handlersRef.current.default?.(data);
          } catch {
            // ignore parse errors
          }
        };
        es.onerror = () => {
          es?.close();
          es = null;
          if (!stopped) {
            retryTimer = setTimeout(connect, 2000);
          }
        };
      } catch {
        if (!stopped) {
          retryTimer = setTimeout(connect, 2000);
        }
      }
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, []);
}
