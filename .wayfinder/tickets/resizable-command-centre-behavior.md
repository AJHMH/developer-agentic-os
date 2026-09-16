---
title: Resizable Command Centre Behavior
parent: ../map.md
labels:
  - wayfinder:prototype
status: closed
assignee: GitHub Copilot
blocked_by:
  - tickets/product-scope-for-first-build.md
---

## Question

What resize behavior should ship as product behavior rather than prototype behavior?

Resolve whether widget dimensions persist, whether users can reset layouts, whether resizing is per-device, how small widgets can become, and whether dragging/reordering joins resizing in the first build.

## Resolution Comment

Developer Agentic OS v2 will ship resizing as first-build product behavior, not only prototype behavior.

Resize decisions:

- Persisted dimensions: page width, central orbit size, widget dimensions, and skill card dimensions persist after reload.
- Persistence location: browser `localStorage` for the first build, because layout is a client-owned preference until sync is needed.
- Reset behavior: provide a Reset layout control that restores the approved baseline dimensions for the page, orbit, widgets, and cards.
- Resize scope: page frame, central orbit, major widgets, and skill cards are resizable.
- Non-resizable elements: individual table rows, icons, routine rows, and micro-app rows are not resizable.
- Minimum sizes: every resizable element has content-safe minimum dimensions. A widget must not shrink below its title/action row plus at least one meaningful content row.
- Overflow behavior: vertical overflow scrolls inside the widget instead of expanding or breaking the page.
- Mobile behavior: mobile resizing is vertical-only.
- Drag/reorder: deferred from the first build. Resizing plus reset ships first; drag/reorder waits for a stronger layout model and edge-case testing.
