import type { LayoutState } from "../types";

export function LayoutModal({
  layout,
  onClose,
  setPageWidth,
  setOrbitSize,
  resetLayout,
}: {
  layout: LayoutState;
  onClose: () => void;
  setPageWidth: (width: number) => void;
  setOrbitSize: (size: number) => void;
  resetLayout: () => void;
}) {
  return (
    <div className="layout-popover" role="presentation" onClick={onClose}>
      <section
        className="layout-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="layout-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="layout-panel-header">
          <h3 id="layout-title">
            Layout <span>resize</span>
          </h3>
          <button
            className="icon-button"
            type="button"
            aria-label="Close layout controls"
            onClick={onClose}
          >
            x
          </button>
        </div>
        <label className="layout-control" htmlFor="page-width-control">
          <span>Page width</span>
          <output>{layout.pageWidth}px</output>
          <input
            id="page-width-control"
            type="range"
            min="1040"
            max="1680"
            step="20"
            value={layout.pageWidth}
            onChange={(event) => setPageWidth(Number(event.target.value))}
          />
        </label>
        <label className="layout-control" htmlFor="orbit-size-control">
          <span>Orbit size</span>
          <output>{layout.orbitSize}px</output>
          <input
            id="orbit-size-control"
            type="range"
            min="480"
            max="780"
            step="10"
            value={layout.orbitSize}
            onChange={(event) => setOrbitSize(Number(event.target.value))}
          />
        </label>
        <button className="reset-layout-button" type="button" onClick={resetLayout}>
          Reset Layout
        </button>
      </section>
    </div>
  );
}
