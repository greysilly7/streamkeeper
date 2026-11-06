// biome-ignore lint/correctness/noUnusedImports: TypeScript uses html as the configured JSX factory.
import { Fragment, html, rawHtml, type Html } from "./jsx";
import THEME_CSS from "./theme";

export function MascotSvg(): Html {
  return (
    <svg
      role="img"
      aria-label="Streamkeeper"
      viewBox="0 0 48 48"
      width="1em"
      height="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M24 4 L44 11 L44 26 C44 38 34 44 24 46 C14 44 6 38 6 26 L6 11 Z" fill="#ffd166" />
      <path
        d="M24 6 L42 13 L42 26 C42 37 33 42 24 44 C15 42 6 37 6 26 L6 13 Z"
        fill="none"
        stroke="#e8b844"
        stroke-width="1.2"
      />
      <path d="M16 24 Q20 18 24 24 Q28 30 32 24" stroke="#e8b844" stroke-width="3" fill="none" stroke-linecap="round" />
    </svg>
  );
}
export function MascotSm(): Html {
  return (
    <span class="mascot mascot-sm">
      <MascotSvg />
    </span>
  );
}
export function PageHead({ title, extraStyles = "" }: { title: string; extraStyles?: string }): Html {
  return (
    <Fragment>
      <meta charset="utf-8" />
      <title>{title} - Streamkeeper</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <link
        rel="icon"
        href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath d='M24 4 L44 11 L44 26 C44 38 34 44 24 46 C14 44 6 38 6 26 L6 11 Z' fill='%23ffd166'/%3E%3Cpath d='M16 24 Q20 18 24 24 Q28 30 32 24' stroke='%23e8b844' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"
        type="image/svg+xml"
      />
      <style>{rawHtml(THEME_CSS)}</style>
      {extraStyles ? <style>{rawHtml(extraStyles)}</style> : null}
    </Fragment>
  );
}
export function ConfirmModal(): Html {
  return (
    <div id="confirmModal" class="modal" style="display: none;">
      <div class="modal-content" style="max-width: 380px;">
        <div class="modal-header">
          <h3 id="confirmModalTitle">Confirm</h3>
          <button type="button" class="modal-close" id="confirmCloseBtn">
            ×
          </button>
        </div>
        <p id="confirmModalMessage" style="color: var(--text-secondary); margin-bottom: var(--space-lg);"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="confirmCancelBtn">
            Cancel
          </button>
          <button type="button" class="btn btn-danger" id="confirmOkBtn">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
export function ToastContainer(): Html {
  return <div id="toastContainer" class="toast-container" aria-live="polite" />;
}
export function InstanceRow({ host }: { host: string }): Html {
  return (
    <div class="instance-row" data-host={host}>
      <span class="instance-row-mark">−</span>
      <span class="instance-row-host">{host}</span>
      <span class="instance-reorder">
        <button type="button" data-move="up" aria-label={`Move ${host} up`}>
          ↑
        </button>
        <button type="button" data-move="down" aria-label={`Move ${host} down`}>
          ↓
        </button>
      </span>
      <button type="button" class="instance-remove" aria-label={`Remove ${host}`}>
        Remove
      </button>
    </div>
  );
}
