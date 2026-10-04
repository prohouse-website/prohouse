(() => {
  const form = document.getElementById('guest-survey');
  if (!form) return;
  const feedback = document.getElementById('survey-feedback');
  const submit = form.querySelector('[type="submit"]');
  const followup = document.getElementById('survey-followup');
  const reviewUrl = 'https://g.page/r/CRV2vE_fnR2LEBM/review';
  const selectedOverall = form.querySelector('input[name="overall"]:checked');
  followup.hidden = !selectedOverall || Number(selectedOverall.value) >= 4;
  const questions = ['overall', 'cleanliness', 'service', 'comfort'];
  form.addEventListener('change', (event) => {
    if (event.target.name === 'overall') {
      if (Number(event.target.value) >= 4) {
        followup.hidden = true;
        window.location.assign(reviewUrl);
        return;
      }
      followup.hidden = false;
    }
    if (questions.includes(event.target.name)) event.target.closest('fieldset')?.classList.remove('is-missing');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    const data = new FormData(form);
    if (Number(data.get('overall')) >= 4) {
      window.location.assign(reviewUrl);
      return;
    }
    let firstMissing = null;
    for (const name of questions) {
      const fieldset = form.querySelector(`input[name="${name}"]`).closest('fieldset');
      const missing = !data.has(name);
      fieldset.classList.toggle('is-missing', missing);
      if (missing && !firstMissing) firstMissing = fieldset;
    }
    if (firstMissing) {
      feedback.textContent = 'Please choose a star rating for every question.';
      firstMissing.querySelector('input').focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'SENDING…';
    try {
      const response = await fetch('/api/survey', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(Object.fromEntries(data))
      });
      if (!response.ok) throw new Error('send failed');
      form.hidden = true;
      const success = document.getElementById('survey-success');
      success.hidden = false;
      success.focus();
    } catch {
      feedback.textContent = 'We could not send your feedback. Please try again shortly, or email hi@prohouse.com.au.';
      submit.disabled = false;
      submit.innerHTML = 'SEND MY FEEDBACK <span aria-hidden="true">→</span>';
    }
  });
})();
