"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutState } from "./types";
import { baselineLayout, layoutStorageKey } from "./types";

export function usePersistedLayout() {
  const [layout, setLayout] = useState<LayoutState>(baselineLayout);
  const [hasLoadedLayout, setHasLoadedLayout] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(layoutStorageKey);
      if (saved) setLayout({ ...baselineLayout, ...JSON.parse(saved) });
    } catch {
      setLayout(baselineLayout);
    } finally {
      setHasLoadedLayout(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedLayout) return;
    localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
  }, [hasLoadedLayout, layout]);

  const setPageWidth = useCallback(
    (pageWidth: number) => setLayout((current) => ({ ...current, pageWidth })),
    []
  );
  const setOrbitSize = useCallback(
    (orbitSize: number) => setLayout((current) => ({ ...current, orbitSize })),
    []
  );
  const setWidgetSize = useCallback((id: string, size: { width: number; height: number }) => {
    setLayout((current) => {
      const existing = current.widgetSizes[id];
      if (
        existing &&
        Math.abs(existing.width - size.width) < 1 &&
        Math.abs(existing.height - size.height) < 1
      )
        return current;
      return { ...current, widgetSizes: { ...current.widgetSizes, [id]: size } };
    });
  }, []);
  const resetLayout = useCallback(() => {
    localStorage.removeItem(layoutStorageKey);
    setLayout(baselineLayout);
  }, []);

  return { layout, setPageWidth, setOrbitSize, setWidgetSize, resetLayout };
}

export function useResizePersistence(
  setWidgetSize: (id: string, size: { width: number; height: number }) => void,
  activeResizeIds: { current: Set<string> },
  initialResizeSizes: { current: Map<string, { width: number; height: number }> }
) {
  const observers = useRef(new Map<string, ResizeObserver>());

  useEffect(
    () => () => {
      observers.current.forEach((observer) => observer.disconnect());
      observers.current.clear();
    },
    []
  );

  return useCallback(
    (id: string) => (node: HTMLElement | null) => {
      observers.current.get(id)?.disconnect();
      observers.current.delete(id);
      if (!node) return;

      const observer = new ResizeObserver(([entry]) => {
        if (!entry) return;
        if (!activeResizeIds.current.has(id)) return;
        const initial = initialResizeSizes.current.get(id);
        const { width, height } = node.getBoundingClientRect();
        if (initial && Math.abs(initial.width - width) < 1 && Math.abs(initial.height - height) < 1)
          return;
        setWidgetSize(id, { width: Math.round(width), height: Math.round(height) });
      });
      observer.observe(node);
      observers.current.set(id, observer);
    },
    [activeResizeIds, initialResizeSizes, setWidgetSize]
  );
}
