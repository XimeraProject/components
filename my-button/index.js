import { register } from 'ximera-core';

register('button', (el, dispatch) => {
  el.classList.add('ximera-button');
  el.addEventListener('click', () => {
    console.log('ximera button clicked:', el.textContent.trim());
  });
});
