export function render(model) {
  for (const [id, state] of Object.entries(model)) {
    const el = document.getElementById(id);
    if (!el) continue;

    if (el.classList.contains('problem-environment')) {
      const parts = [];
      parts.push(state.available ? 'available' : 'unavailable');
      if (state.complete) parts.push('complete');
      if (state.experienced) parts.push('experienced');
      el.dataset.state = parts.join(' ');
    }

    else if (el.classList.contains('feedback')) {
      el.dataset.state = state.visible ? 'visible' : 'hidden';
    }

    else if (el.classList.contains('answer') && el.classList.contains('respondable')) {
      const parts = ['respondable'];
      if (state.correct) parts.push('correct');
      else if (state.attempt !== undefined && state.attempt !== null) parts.push('attempted');
      el.dataset.state = parts.join(' ');

      // Sync the input (inside the placeholder) with saved state.
      const placeholderId = el.dataset.placeholderId;
      const placeholder = placeholderId ? document.getElementById(placeholderId) : null;
      const input = placeholder?.querySelector('.ximera-answer-input');
      if (input) {
        if (state.response !== undefined && input.value !== state.response)
          input.value = state.response;
        input.disabled = !!state.correct;
      }

      // Show/hide the check button (it sits after .ximera-math-with-answers)
      const wrapper = el.closest('.ximera-math-with-answers');
      const btn = wrapper?.nextElementSibling;
      if (btn?.classList.contains('ximera-check-btn') && btn.dataset.answerId === id) {
        btn.style.display = state.correct ? 'none' : '';
      }
    }

    else if (
      el.classList.contains('multiple-choice') ||
      el.classList.contains('select-all')
    ) {
      const parts = [];
      if (state.correct) parts.push('correct');
      else if (state.checked !== undefined && state.checked !== null) parts.push('attempted');
      el.dataset.state = parts.join(' ');

      el.querySelectorAll('.choice').forEach(choiceEl => {
        const cid = choiceEl.id;
        const cparts = [];
        const chosen = state.chosen;
        if (cid === chosen || (Array.isArray(chosen) && chosen.includes(cid)))
          cparts.push('selected');
        if (state.wrong?.[cid]) cparts.push('eliminated');
        if (state.correct) cparts.push('revealed');
        choiceEl.dataset.state = cparts.join(' ');
        // Update aria-checked for select-all checkboxes
        if (el.classList.contains('select-all'))
          choiceEl.setAttribute('aria-checked',
            (Array.isArray(chosen) && chosen.includes(cid)) ? 'true' : 'false');
      });
    }

    else if (el.classList.contains('word-choice')) {
      const parts = [];
      if (state.correct) parts.push('correct');
      else if (state.checked !== undefined && state.checked !== null) parts.push('attempted');
      el.dataset.state = parts.join(' ');

      const sel = el.querySelector('select');
      if (sel) {
        if (state.chosen !== undefined) sel.value = state.chosen;
        sel.disabled = !!state.correct;
      }
    }

    else if (el.classList.contains('free-response')) {
      el.dataset.state = state.submitted ? 'submitted' : '';

      const ta = el.querySelector('textarea');
      if (ta && state.response !== undefined && ta.value !== state.response)
        ta.value = state.response;

      const btn = el.querySelector('.ximera-submit-btn');
      if (btn) btn.disabled = !!state.submitted;
    }

    // Hint content (.xmhint-content): controlled by HINT_REVEAL
    else if (el.classList.contains('xmhint-content')) {
      el.dataset.state = state.revealed ? 'visible' : 'hidden';
      const header = el.previousElementSibling;
      if (header) header.setAttribute('aria-expanded', state.revealed ? 'true' : 'false');
    }
  }
}
