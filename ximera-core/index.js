import { ModulusAgent } from '@modulus-learning/agent';
import { initialModel, modelFromPageState, modelToPageState } from './model.js';
import { update } from './update.js';
import { render } from './render.js';
import { calculateProgress } from './progress.js';
import Expression from 'math-expressions';

const agent = new ModulusAgent();
let model = initialModel();
const registry = new Map();

export function register(selector, mountFn) {
  registry.set(selector, mountFn);
}

export function dispatch(msg) {
  model = update(model, msg);
  render(model);
  agent.setPageState(modelToPageState(model));
  agent.setProgress(calculateProgress(model));
}

// ─── Agent lifecycle ───────────────────────────────────────────────────────

agent.onReady(async () => {
  const saved = agent.pageState();
  if (saved && Object.keys(saved).length > 0) {
    model = update(model, { type: 'PAGE_STATE_RESTORED', pageState: modelFromPageState(saved) });
  } else {
    model = update(model, { type: 'AGENT_READY_OFFLINE' });
  }

  // Phase 1: mount components that don't depend on MathJax rendering
  mountMultipleChoice();
  mountSelectAll();
  mountWordChoice();
  mountFreeResponse();
  mountHints();

  for (const [selector, mountFn] of registry) {
    document.querySelectorAll(selector).forEach(el => mountFn(el, dispatch));
  }

  render(model);

  // Phase 2: answer overlays — must wait for MathJax to finish rendering
  // so we can read bounding rects of the rendered \square placeholders.
  await waitForMathJax();
  mountAnswerBlanks();
  render(model);
});

agent.on('pagestate-changed', ({ pageState }) => {
  model = update(model, { type: 'PAGE_STATE_RESTORED', pageState: modelFromPageState(pageState) });
  render(model);
});

// ─── MathJax timing ───────────────────────────────────────────────────────

async function waitForMathJax() {
  if (!window.MathJax?.startup?.promise) return;
  await window.MathJax.startup.promise;
  if (typeof window.MathJax.typesetPromise === 'function') {
    await window.MathJax.typesetPromise();
  }
}

// ─── Answer blanks ────────────────────────────────────────────────────────

// After MathJax renders, each \answer in math has a \cssId-wrapped
// \phantom{\text{VALUE}} that (a) reserves the right space inside the
// MathJax layout and (b) gives us a DOM element to attach the input to.
//
// The input is appended as a child of the placeholder element — making it
// part of the MathJax DOM subtree. When the page reflows (line wrap, zoom,
// resize) the placeholder moves with the math and the input moves with it.
// No JS-based repositioning or ResizeObserver is needed.
function mountAnswerBlanks() {
  document.querySelectorAll('.ximera-math-with-answers').forEach(wrapper => {
    wrapper.querySelectorAll('.answer.respondable').forEach(stateHolder => {
      const placeholderId = stateHolder.dataset.placeholderId;
      if (!placeholderId) return;
      const answerId = stateHolder.id;
      const correctText = stateHolder.dataset.correctText ?? '';

      // The \cssId{placeholderId}{\phantom{...}} element rendered by MathJax.
      const placeholder = document.getElementById(placeholderId);
      if (!placeholder) return;

      // Make the placeholder a positioning parent. Its dimensions are already
      // set by MathJax from the \phantom — we just turn it into a container.
      placeholder.style.position = 'relative';
      placeholder.style.display = 'inline-block';
      // The phantom content is already invisible (\phantom = zero colour).
      // Explicitly hide to be safe; the input overrides this below.
      placeholder.style.visibility = 'hidden';

      // Read the height MathJax allocated (from \vphantom{\bigg|}).
      // This is the authoritative measurement — we don't guess or hardcode.
      const pRect = placeholder.getBoundingClientRect();

      // Input lives INSIDE the placeholder — it's part of the MathJax flow.
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ximera-answer-input';
      input.setAttribute('aria-label', 'answer');
      input.dataset.answerId = answerId;
      input.dataset.placeholderId = placeholderId;
      // Fill the placeholder exactly: width from \hphantom, height from \vphantom.
      // Using explicit pixels (from MathJax's own render) ensures the input
      // matches the allocated slot with no overflow or gap.
      input.style.visibility = 'visible'; // override inherited hidden
      input.style.position = 'absolute';
      input.style.top = '0';
      input.style.left = '0';
      input.style.width = '100%';
      input.style.height = `${pRect.height}px`;

      // Math-preview popover, also inside the placeholder so it's positioned
      // relative to the blank, not the outer wrapper.
      const popover = document.createElement('div');
      popover.className = 'ximera-math-popover';
      popover.style.visibility = 'visible';
      popover.setAttribute('aria-live', 'polite');

      placeholder.appendChild(input);
      placeholder.appendChild(popover);

      // Check button sits after the wrapper in normal document flow.
      const btn = document.createElement('button');
      btn.className = 'ximera-check-btn';
      btn.type = 'button';
      btn.textContent = 'Check';
      btn.dataset.answerId = answerId;
      wrapper.after(btn);

      // Wire events
      let popoverTimer;
      input.addEventListener('input', () => {
        dispatch({ type: 'ANSWER_INPUT', id: answerId, value: input.value });
        clearTimeout(popoverTimer);
        popoverTimer = setTimeout(() => updateMathPopover(popover, input.value), 300);
      });

      const checkFn = () => dispatch({ type: 'ANSWER_CHECK', id: answerId, correctText });
      btn.addEventListener('click', checkFn);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') checkFn(); });
    });
  });
}

async function updateMathPopover(popover, value) {
  if (!value.trim()) {
    popover.style.display = 'none';
    return;
  }
  try {
    const latex = Expression.fromText(value).toLatex();
    if (window.MathJax?.tex2svgPromise) {
      const node = await window.MathJax.tex2svgPromise(latex, { display: false });
      popover.replaceChildren(node);
    } else {
      popover.textContent = value;
    }
    popover.style.display = 'block';
  } catch {
    // Unparseable input: show raw text as fallback
    popover.textContent = value;
    popover.style.display = 'block';
  }
}

// ─── Multiple choice ───────────────────────────────────────────────────────

function mountMultipleChoice() {
  document.querySelectorAll('.multiple-choice').forEach(el => {
    if (!el.id) return;
    const problemId = el.id;

    el.querySelectorAll('.choice').forEach(choice => {
      choice.setAttribute('role', 'button');
      choice.setAttribute('tabindex', '0');
      const activate = () => dispatch({ type: 'CHOICE_SELECT', problemId, choiceId: choice.id });
      choice.addEventListener('click', activate);
      choice.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
    });

    const btn = document.createElement('button');
    btn.className = 'ximera-check-btn';
    btn.type = 'button';
    btn.textContent = 'Check';
    btn.addEventListener('click', () => dispatch({ type: 'MULTIPLE_CHOICE_CHECK', problemId }));
    el.append(btn);
  });
}

// ─── Select all ────────────────────────────────────────────────────────────

function mountSelectAll() {
  document.querySelectorAll('.select-all').forEach(el => {
    if (!el.id) return;
    const problemId = el.id;

    el.querySelectorAll('.choice').forEach(choice => {
      choice.setAttribute('role', 'checkbox');
      choice.setAttribute('tabindex', '0');
      choice.setAttribute('aria-checked', 'false');
      const toggle = () => dispatch({ type: 'SELECT_ALL_TOGGLE', problemId, choiceId: choice.id });
      choice.addEventListener('click', toggle);
      choice.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(); });
    });

    const btn = document.createElement('button');
    btn.className = 'ximera-check-btn';
    btn.type = 'button';
    btn.textContent = 'Check';
    btn.addEventListener('click', () => dispatch({ type: 'SELECT_ALL_CHECK', problemId }));
    el.append(btn);
  });
}

// ─── Word choice ───────────────────────────────────────────────────────────

// \wordChoice{...} renders as <span class="word-choice" id="word-choice-N">
// with <span class="choice [correct]" id="choice-N"> children.
// We convert these to a <select> dropdown; selecting immediately checks.
function mountWordChoice() {
  document.querySelectorAll('.word-choice').forEach(el => {
    if (!el.id) return;
    const problemId = el.id;
    const choices = [...el.querySelectorAll('.choice')];

    const select = document.createElement('select');
    select.className = 'ximera-word-select';
    select.innerHTML = '<option value="">—</option>';
    choices.forEach(choice => {
      const opt = document.createElement('option');
      opt.value = choice.id;
      opt.textContent = choice.textContent.trim();
      select.appendChild(opt);
    });
    // Hide original choice spans (they carry the .correct class we still query)
    choices.forEach(c => { c.style.display = 'none'; });
    el.prepend(select);

    select.addEventListener('change', () => {
      if (select.value)
        dispatch({ type: 'WORD_CHOICE_SELECT', problemId, choiceId: select.value });
    });
  });
}

// ─── Free response ─────────────────────────────────────────────────────────

// \begin{freeResponse} renders as <div class="free-response" id="problem-N">.
// Submission counts as complete and unblocks subsequent problems.
function mountFreeResponse() {
  document.querySelectorAll('.free-response').forEach(el => {
    if (!el.id) return;
    const id = el.id;

    const textarea = document.createElement('textarea');
    textarea.className = 'ximera-free-response-input';
    textarea.setAttribute('aria-label', 'response');

    const btn = document.createElement('button');
    btn.className = 'ximera-submit-btn';
    btn.type = 'button';
    btn.textContent = 'Submit';

    textarea.addEventListener('input', () =>
      dispatch({ type: 'FREE_RESPONSE_INPUT', id, value: textarea.value }));
    btn.addEventListener('click', () =>
      dispatch({ type: 'FREE_RESPONSE_SUBMIT', id }));

    el.append(textarea, btn);
  });
}

// ─── Hints ────────────────────────────────────────────────────────────────

// \begin{hint} renders via ximera.4ht's expandable environment as:
//   <div class="accordion">
//     <h3 class="xmhint">Hint</h3>
//     <div class="accordion-item xmhint-content" id="accordion-itemN">...</div>
//   </div>
// We wire the h3 as a reveal trigger; the content div id becomes the model key.
let hintCounter = 0;
function mountHints() {
  document.querySelectorAll('h3.xmhint').forEach(header => {
    const content = header.nextElementSibling;
    if (!content?.classList.contains('xmhint-content')) return;
    if (!content.id) content.id = `ximera-hint-${++hintCounter}`;
    const id = content.id;

    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');

    const reveal = () => dispatch({ type: 'HINT_REVEAL', id });
    header.addEventListener('click', reveal);
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') reveal();
    });
  });
}
