var TOKENS_CSS = `:root {
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --space-2xl: 4rem;

  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  --bg-base: #1c1917;
  --bg-surface: rgba(41, 37, 36, 0.65);
  --bg-elevated: rgba(28, 25, 23, 0.95);
  --border-glass: rgba(255, 209, 102, 0.15);
  --border-subtle: rgba(168, 162, 158, 0.2);

  --text-primary: #fafaf9;
  --text-secondary: #a8a29e;
  --text-muted: #78716c;

  --accent-gold: #ffd166;
  --accent-gold-hover: #f4a261;
  --accent-blue: #60a5fa;
  --accent-green: #34d399;
  --accent-red: #ef4444;
  --accent-red-hover: #dc2626;

  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-glow: 0 0 20px rgba(255, 209, 102, 0.3);
  --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.25);

  --font-body: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  background: var(--bg-base);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: var(--space-xl);
}

.container {
  width: 100%;
  max-width: 1000px;
}

h1 {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: var(--space-sm);
}

h2 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: var(--space-xl);
  margin-bottom: var(--space-md);
}

h3 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 0;
  margin-bottom: var(--space-sm);
}

.gradient-text {
  background: linear-gradient(to right, var(--text-primary), var(--text-secondary));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.info-link {
  display: block;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
  text-decoration: none;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.info-link:hover {
  color: var(--accent-gold);
  text-decoration: underline;
}
`;
var ANIMATIONS_CSS = `@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeInDown {
  from { opacity: 0; transform: translateY(-16px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes zoomIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes zoomInModal {
  from { opacity: 0; transform: scale(0.95) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes mascot-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes toastSlideIn {
  from { opacity: 0; transform: translateX(100%); }
  to { opacity: 1; transform: translateX(0); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
var BASE_CSS = `.glass-card {
  background: var(--bg-surface);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}

.settings-card {
  padding: var(--space-lg);
  margin-bottom: var(--space-md);
}

.account-card {
  background: var(--bg-surface);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: var(--space-lg);
  transition: transform var(--transition-base), box-shadow var(--transition-base);
}

.account-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-glass);
}

.account-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
}

.account-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.account-body {
  margin-top: var(--space-sm);
}

.install-field label {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
  font-weight: 600;
}

.url-with-copy {
  display: flex;
  gap: var(--space-sm);
}

.url-input {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.3);
  color: var(--text-secondary);
  cursor: default;
}

.url-input:focus {
  outline: none;
  border-color: var(--accent-gold);
  box-shadow: 0 0 0 2px rgba(255, 209, 102, 0.15);
}

.account-actions {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  gap: var(--space-sm);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  font-size: 0.875rem;
  font-weight: 500;
  font-family: var(--font-body);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
  text-decoration: none;
  line-height: 1.4;
}

.btn-primary {
  background: linear-gradient(135deg, var(--accent-gold), var(--accent-gold-hover));
  color: #1c1917;
  font-weight: 600;
}

.btn-primary:hover {
  box-shadow: var(--shadow-glow);
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
}

.btn-secondary {
  background: rgba(168, 162, 158, 0.15);
  color: var(--text-primary);
  border-color: var(--border-subtle);
}

.btn-secondary:hover {
  background: rgba(168, 162, 158, 0.25);
}

.btn-danger {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red);
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.btn-loading {
  position: relative;
  pointer-events: none;
}

.btn-loading::after {
  content: "";
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-left: 0.35rem;
  vertical-align: middle;
}

.btn-icon {
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  justify-content: center;
  background: transparent;
  border-color: transparent;
  color: var(--text-muted);
}

.btn-icon:hover:not(:disabled) {
  color: var(--accent-gold);
  background: rgba(255, 209, 102, 0.1);
}

.btn-icon:disabled {
  opacity: 0.35;
}

.btn-icon.btn-dirty {
  color: var(--accent-gold);
}

.btn-icon.btn-spin svg {
  animation: spin 0.8s linear infinite;
}

.shake {
  animation: shake 0.4s ease;
}

.form-group {
  margin-bottom: var(--space-md);
}

.form-group label {
  display: block;
  margin-bottom: 0.35rem;
  font-weight: 500;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-size: 0.875rem;
  font-family: var(--font-body);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.3);
  color: var(--text-primary);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--accent-gold);
  box-shadow: 0 0 0 2px rgba(255, 209, 102, 0.15);
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.form-group input.error {
  border-color: var(--accent-red);
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  appearance: none;
  width: 1.1rem;
  height: 1.1rem;
  border: 1px solid var(--border-glass);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}

.checkbox-label input[type="checkbox"]:checked {
  background: var(--accent-gold);
  border-color: var(--accent-gold);
}

.checkbox-label input[type="checkbox"]:checked::after {
  content: "\u2713";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #1c1917;
  font-size: 0.7rem;
  font-weight: 700;
}

.mascot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  animation: mascot-bob 1.5s ease-in-out infinite;
  filter: drop-shadow(0 0 8px rgba(255, 209, 102, 0.4));
  position: relative;
  line-height: 1;
}

.mascot::after {
  content: "";
  position: absolute;
  inset: -20px;
  background: radial-gradient(circle, rgba(255, 209, 102, 0.15), transparent 70%);
  filter: blur(12px);
  pointer-events: none;
  z-index: -1;
}

.mascot-sm {
  font-size: 1.5rem;
}

.mascot-lg {
  font-size: 4.5rem;
}

.loading-mascot {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  color: var(--text-secondary);
}

.loading-mascot .mascot {
  font-size: 1.25rem;
}

.modal {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  justify-content: center;
  align-items: center;
  z-index: 1000;
  animation: fadeIn 200ms ease;
  overflow-y: auto;
}

.modal-content {
  background: var(--bg-elevated);
  backdrop-filter: blur(24px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-glass);
  padding: var(--space-lg);
  width: 100%;
  max-width: 480px;
  margin: var(--space-md);
  animation: zoomInModal 250ms ease;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
}

.modal-header h3 {
  margin: 0;
  font-size: 1.15rem;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
  padding: 0.25rem;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast);
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  margin-top: var(--space-lg);
}

.toast-container {
  position: fixed;
  top: var(--space-lg);
  right: var(--space-lg);
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: var(--shadow-glass);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  animation: toastSlideIn 300ms ease;
  max-width: 360px;
}

.toast-success {
  background: rgba(52, 211, 153, 0.2);
  border-color: rgba(52, 211, 153, 0.3);
  color: var(--accent-green);
}

.toast-error {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--accent-red);
}

.toast-info {
  background: rgba(96, 165, 250, 0.2);
  border-color: rgba(96, 165, 250, 0.3);
  color: var(--accent-blue);
}

.copy-btn {
  padding: var(--space-sm) var(--space-md);
  background: rgba(255, 209, 102, 0.15);
  color: var(--accent-gold);
  border: 1px solid rgba(255, 209, 102, 0.3);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-family: var(--font-body);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
}

.copy-btn:hover {
  background: rgba(255, 209, 102, 0.25);
}

.copy-btn.copied {
  background: rgba(52, 211, 153, 0.2);
  border-color: rgba(52, 211, 153, 0.3);
  color: var(--accent-green);
  cursor: default;
}
`;
var COMPONENT_CSS = `.health-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.5rem;
  border-radius: 100px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.health-badge-normal {
  background: rgba(52, 211, 153, 0.15);
  color: var(--accent-green);
  border: 1px solid rgba(52, 211, 153, 0.3);
}

.health-badge-failover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--accent-red);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.health-badge-unknown {
  background: rgba(168, 162, 158, 0.1);
  color: var(--text-muted);
  border: 1px solid rgba(168, 162, 158, 0.2);
}

.status-card {
  padding: var(--space-lg);
  margin-bottom: var(--space-md);
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.85rem;
}

.status-row:last-child {
  border-bottom: none;
}

.status-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.status-value {
  color: var(--text-primary);
  text-align: right;
  word-break: break-all;
}

.status-value-warning {
  color: var(--accent-red);
}

.host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.host-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  font-size: 0.8rem;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--border-subtle);
  word-break: break-all;
}

.host-item-up {
  border-color: rgba(52, 211, 153, 0.3);
}

.host-item-down {
  border-color: rgba(239, 68, 68, 0.3);
}

.host-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.host-indicator-up {
  background: var(--accent-green);
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
}

.host-indicator-down {
  background: var(--accent-red);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
}

.host-latency {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-left: auto;
  white-space: nowrap;
}

.step-indicator {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: var(--space-xl);
}

.step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(168, 162, 158, 0.3);
  transition: all var(--transition-fast);
}

.step-dot.active {
  background: var(--accent-gold);
  box-shadow: 0 0 8px rgba(255, 209, 102, 0.4);
  width: 28px;
  border-radius: 5px;
}

.step-dot.done {
  background: var(--accent-green);
}

.wizard-step {
  animation: fadeIn 200ms ease;
}

.wizard-step.hidden {
  display: none;
}

.wizard-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-lg);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--border-subtle);
}

.tab-nav {
  display: flex;
  gap: 0.25rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 100px;
  padding: 3px;
  margin-bottom: var(--space-lg);
  border: 1px solid var(--border-glass);
}

.tab-btn {
  padding: 0.4rem 1rem;
  border: none;
  border-radius: 100px;
  font-size: 0.8rem;
  font-weight: 500;
  font-family: var(--font-body);
  cursor: pointer;
  background: transparent;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  opacity: 0.7;
}

.tab-btn:hover {
  opacity: 0.9;
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--accent-gold);
  color: #1c1917;
  opacity: 1;
  box-shadow: var(--shadow-glow);
}

.tab-panel {
  animation: fadeIn 200ms ease;
}

.tab-panel.hidden {
  display: none;
}

/* \u2500\u2500 Info Icon \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

.info-icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15em;
  height: 1.15em;
  border-radius: 50%;
  border: 1px solid var(--text-muted);
  color: var(--text-muted);
  font-size: 0.65em;
  font-weight: 700;
  font-style: normal;
  font-family: var(--font-mono);
  line-height: 1;
  cursor: help;
  vertical-align: middle;
  margin-left: 0.3em;
  transition: all var(--transition-fast);
  user-select: none;
}

.info-icon::before {
  content: "i";
}

.info-icon:hover {
  border-color: var(--accent-gold);
  color: var(--accent-gold);
}

.info-icon::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  padding: 0.5rem 0.75rem;
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-secondary);
  white-space: normal;
  word-break: break-word;
  max-width: 260px;
  width: max-content;
  line-height: 1.4;
  box-shadow: var(--shadow-glass);
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
  transition: opacity var(--transition-base), visibility var(--transition-base);
  z-index: 100;
}

.info-icon:hover::after {
  visibility: visible;
  opacity: 1;
}
`;
var PAGE_CSS = `.account-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.explainer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.admin-auth {
  margin: var(--space-xl) 0;
  padding: var(--space-lg);
}

.cache-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  margin-bottom: var(--space-xl);
  padding: var(--space-md);
  background: var(--bg-surface);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.cache-row label {
  white-space: nowrap;
  margin: 0;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.range-input {
  flex: 1;
  min-width: 160px;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(168, 162, 158, 0.2);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.range-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-gold), var(--accent-gold-hover));
  cursor: pointer;
  box-shadow: 0 0 8px rgba(255, 209, 102, 0.3);
}

.range-input::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-gold), var(--accent-gold-hover));
  cursor: pointer;
  border: none;
}

.range-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85rem;
  color: var(--text-primary);
  margin-top: 0.25rem;
}

.range-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 0.65rem;
  color: var(--text-muted);
  flex-basis: 100%;
  margin-top: 0.15rem;
}

.accounts-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.accounts-title #addAccountBtn {
  margin: 0;
}

.explainer-details {
  margin-bottom: var(--space-xl);
}

.explainer-details summary {
  cursor: pointer;
  list-style: none;
  font-size: 1rem;
  font-weight: 500;
  color: var(--accent-gold);
  padding: 0.25rem 0;
  user-select: none;
}

.explainer-details summary::-webkit-details-marker { display: none; }

.explainer-details summary::before {
  content: "\\25B8";
  display: inline-block;
  margin-right: var(--space-sm);
  transition: transform var(--transition-base);
}

.explainer-details[open] summary::before {
  transform: rotate(90deg);
}

.explainer-details .explainer-grid {
  margin-top: var(--space-md);
  margin-bottom: 0;
}

.footer {
  margin-top: var(--space-xl);
  font-size: 0.85rem;
  text-align: center;
  color: var(--text-muted);
}

.footer a {
  color: var(--text-muted);
  text-decoration: none;
  margin: 0 var(--space-sm);
  transition: color var(--transition-fast);
}

.footer a:hover {
  color: var(--accent-gold);
  text-decoration: underline;
}

.login-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: var(--space-md);
}

.login-card {
  width: 100%;
  max-width: 400px;
  padding: var(--space-2xl);
  text-align: center;
}

.login-card h1 {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}

.login-card .subtitle {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-bottom: var(--space-xl);
}

.login-card .form-group {
  text-align: left;
}

.login-error {
  font-size: 0.85rem;
  color: var(--accent-red);
  margin-top: var(--space-sm);
}

.login-error:empty {
  display: none;
}

.login-card .btn-primary {
  width: 100%;
  justify-content: center;
  margin-top: var(--space-md);
}

.login-card .info-link {
  margin-bottom: var(--space-xl);
}

.login-card #passwordHelpLink {
  margin-bottom: var(--space-md);
  margin-top: calc(-1 * var(--space-sm));
}

.setup-page { max-width: 760px; padding: var(--space-xl) 0; }
.setup-hero { margin: 0 auto var(--space-xl); max-width: 640px; text-align: center; }
.setup-eyebrow { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border-glass); border-radius: 999px; color: var(--accent-gold); background: rgba(255, 209, 102, 0.07); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.setup-eyebrow-dot { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: var(--accent-green); box-shadow: 0 0 10px rgba(52, 211, 153, 0.8); }
.setup-hero h1 { margin-top: var(--space-md); font-size: clamp(2rem, 5vw, 3rem); letter-spacing: -0.04em; }
.setup-intro { max-width: 560px; margin: var(--space-sm) auto 0; color: var(--text-secondary); font-size: 1rem; }
.setup-form { display: grid; gap: var(--space-md); }
.setup-card { padding: clamp(var(--space-md), 4vw, var(--space-xl)); }
.setup-card-heading { display: flex; gap: var(--space-md); align-items: flex-start; margin-bottom: var(--space-lg); }
.setup-card-heading h2 { margin: 0 0 0.2rem; font-size: 1.15rem; }
.setup-card-heading p { color: var(--text-secondary); font-size: 0.82rem; }
.setup-step { display: grid; place-items: center; width: 2rem; height: 2rem; flex: 0 0 2rem; border: 1px solid rgba(255, 209, 102, 0.35); border-radius: 10px; color: var(--accent-gold); background: rgba(255, 209, 102, 0.08); font-family: var(--font-mono); font-size: 0.7rem; font-weight: 700; }
.field-hint { display: block; margin-top: 0.4rem; color: var(--text-muted); font-size: 0.72rem; }
.preferred-instance { padding: var(--space-md); margin-bottom: var(--space-lg); border: 1px solid rgba(52, 211, 153, 0.25); border-radius: var(--radius-md); background: linear-gradient(135deg, rgba(52, 211, 153, 0.08), rgba(0, 0, 0, 0.12)); }
.instance-label { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm); color: var(--text-primary); font-size: 0.85rem; }
.instance-label strong, .instance-label small { display: block; }
.instance-label small { margin-top: 0.1rem; color: var(--text-muted); font-size: 0.7rem; font-weight: 400; }
.instance-status-dot { width: 0.55rem; height: 0.55rem; flex: 0 0 0.55rem; border-radius: 50%; background: var(--accent-green); box-shadow: 0 0 10px rgba(52, 211, 153, 0.65); }
.fallback-heading { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-sm); margin-bottom: 0.4rem; }
.fallback-heading label { color: var(--text-primary); font-size: 0.85rem; font-weight: 600; }
.instance-count { color: var(--text-muted); font-size: 0.7rem; }
.instance-textarea { min-height: 150px; resize: vertical; font-family: var(--font-mono); font-size: 0.78rem; line-height: 1.8; }
.setup-submit { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); padding: var(--space-sm) 0; }
.setup-submit .btn-primary { padding: 0.8rem 1.1rem; }
.secure-note { color: var(--text-muted); font-size: 0.72rem; }
.secure-note span { color: var(--accent-gold); margin-right: 0.25rem; }
.setup-result { min-height: 0; margin-top: 0; padding: 0; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; }
.setup-result:not(:empty) { padding: var(--space-md); border: 1px solid var(--border-glass); border-radius: var(--radius-md); background: rgba(0, 0, 0, 0.2); }
.setup-brand { display: flex; align-items: center; justify-content: center; gap: 0.55rem; margin-bottom: var(--space-md); color: var(--text-primary); font-size: 0.85rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.setup-brand .mascot { width: 2rem; height: 2rem; }
.instance-value { min-height: 2.5rem; display: flex; align-items: center; padding: var(--space-sm) var(--space-md); border: 1px solid rgba(52, 211, 153, 0.2); border-radius: var(--radius-sm); background: rgba(0, 0, 0, 0.18); color: var(--text-primary); font-family: var(--font-mono); font-size: 0.78rem; overflow-wrap: anywhere; }
.instance-list { display: grid; gap: 0.45rem; }
.instance-row { display: flex; align-items: center; gap: 0.55rem; min-height: 2.5rem; padding: 0.35rem 0.45rem 0.35rem 0.7rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: rgba(0, 0, 0, 0.18); transition: border-color var(--transition-fast), background var(--transition-fast); }
.instance-row:hover { border-color: rgba(255, 209, 102, 0.35); background: rgba(255, 209, 102, 0.04); }
.instance-row-mark { color: var(--accent-gold); font-size: 1.1rem; line-height: 1; }
.instance-row-host { min-width: 0; flex: 1; overflow-wrap: anywhere; color: var(--text-primary); font-family: var(--font-mono); font-size: 0.76rem; }
.instance-reorder { display: inline-flex; gap: 0.2rem; }
.instance-reorder button { width: 1.65rem; height: 1.65rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: rgba(255, 209, 102, 0.05); color: var(--text-muted); cursor: pointer; font-size: 0.82rem; line-height: 1; }
.instance-reorder button:hover { border-color: var(--accent-gold); background: rgba(255, 209, 102, 0.14); color: var(--accent-gold); }
.instance-remove { border: 0; padding: 0.35rem 0.55rem; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; font-family: var(--font-body); font-size: 0.72rem; }
.instance-remove:hover { background: rgba(239, 68, 68, 0.12); color: var(--accent-red); }
.instance-add { display: flex; gap: var(--space-sm); margin-top: var(--space-sm); }
.instance-add .form-input { min-width: 0; height: 2.65rem; padding: 0.65rem 0.8rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: rgba(0, 0, 0, 0.28); color: var(--text-primary); font-family: var(--font-mono); font-size: 0.76rem; outline: none; transition: border-color var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast); }
.instance-add .form-input::placeholder { color: var(--text-muted); opacity: 1; }
.instance-add .form-input:hover { border-color: rgba(255, 209, 102, 0.35); }
.instance-add .form-input:focus { border-color: var(--accent-gold); background: rgba(0, 0, 0, 0.4); box-shadow: 0 0 0 3px rgba(255, 209, 102, 0.12); }
.instance-add .btn { flex: 0 0 auto; min-height: 2.65rem; border-color: rgba(255, 209, 102, 0.25); background: rgba(255, 209, 102, 0.08); color: var(--accent-gold); }
.instance-add .btn:hover { border-color: var(--accent-gold); background: rgba(255, 209, 102, 0.16); box-shadow: none; transform: none; }
.setup-footer { margin: var(--space-lg) 0 0; color: var(--text-muted); font-size: 0.7rem; text-align: center; opacity: 0.72; }
.setup-footer a { color: var(--text-secondary); text-decoration: none; border-bottom: 1px solid rgba(168, 162, 158, 0.3); }
.setup-footer a:hover { color: var(--accent-gold); border-color: var(--accent-gold); }

@media (max-width: 800px) {
  body { padding: var(--space-md); }
  .container { padding: 0; }
  .account-cards-grid { grid-template-columns: 1fr; }
  .explainer-grid { grid-template-columns: 1fr; }
  .url-with-copy { flex-direction: column; }
  .cache-row { flex-direction: column; align-items: stretch; }
  .cache-row label { margin-bottom: 0.25rem; }
  .host-grid { grid-template-columns: 1fr; }
  .setup-page { padding-top: var(--space-md); }
  .setup-submit { align-items: stretch; flex-direction: column; }
  .setup-submit .btn-primary { justify-content: center; }
}
`;
var THEME_CSS = `${TOKENS_CSS}${ANIMATIONS_CSS}${BASE_CSS}${COMPONENT_CSS}${PAGE_CSS}`;


export { THEME_CSS };
