/*
 * RRMS Contact Us: a floating button (bottom-right, on every page) that opens a small panel with the contact
 * details and a short message form. It is not a page or a tab.
 *
 * One implementation, used by the React app (frontend/index.html) and by the passenger area
 * (frontend/public/user/index.html). Styles come from /rrms-theme.css.
 * The message is sent to POST /api/contact (saved in MongoDB). API address: window.RRMS_CONFIG.API_BASE_URL.
 *
 * The helpline, e-mail and address come from GET /api/contact-info, which reads the SETTING rows CONTACT_HELPLINE,
 * CONTACT_EMAIL and CONTACT_ADDRESS. Change them in one place: Admin portal, Settings. The values shipped with the
 * project are DEMO values, not a real helpline.
 */
(function () {
  if (window.__rrmsContactLoaded) return;
  window.__rrmsContactLoaded = true;

  var API = (window.RRMS_CONFIG && window.RRMS_CONFIG.API_BASE_URL) || 'http://localhost:5000';

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (html) node.innerHTML = html;
    return node;
  }

  function build() {
    var fab = el('button', { type: 'button', class: 'rrms-contact-fab', 'aria-label': 'Contact Us', 'aria-haspopup': 'dialog' },
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Contact Us</span>');

    var backdrop = el('div', { class: 'rrms-modal-backdrop', hidden: 'hidden', role: 'presentation' });
    backdrop.innerHTML =
      '<div class="rrms-modal" role="dialog" aria-modal="true" aria-labelledby="rrms-contact-title">' +
        '<h2 id="rrms-contact-title">Contact Us</h2>' +
        '<ul class="rrms-contact-list" id="rrms-contact-details"><li>Loading contact details...</li></ul>' +
        '<form id="rrms-contact-form" novalidate>' +
          '<div style="display:grid;gap:10px">' +
            '<label class="rrms-field">Your name<input class="rrms-input" name="name" maxlength="80" autocomplete="name" required></label>' +
            '<label class="rrms-field">Your e-mail<input class="rrms-input" name="email" type="email" maxlength="120" autocomplete="email" required></label>' +
            '<label class="rrms-field">Message<textarea class="rrms-textarea" name="message" rows="3" maxlength="1000" required></textarea></label>' +
          '</div>' +
          '<p id="rrms-contact-msg" role="status" style="margin:10px 0 0;font-size:13px;min-height:18px"></p>' +
          '<div class="rrms-contact-actions">' +
            '<button type="button" class="rrms-btn rrms-btn-secondary" id="rrms-contact-close">Close</button>' +
            '<button type="submit" class="rrms-btn rrms-btn-primary" id="rrms-contact-send">Send message</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    document.body.appendChild(fab);
    document.body.appendChild(backdrop);

    var form = backdrop.querySelector('#rrms-contact-form');
    var msg = backdrop.querySelector('#rrms-contact-msg');
    var send = backdrop.querySelector('#rrms-contact-send');

    // Contact details from SETTING (through the API). Text is set with textContent, never as HTML.
    var details = backdrop.querySelector('#rrms-contact-details');
    var detailsLoaded = false;
    function loadDetails() {
      if (detailsLoaded) return;
      fetch(API + '/api/contact-info')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.success) throw new Error('no details');
          details.textContent = '';
          [['Helpdesk', j.data.helpline], ['E-mail', j.data.email], ['Address', j.data.address]].forEach(function (row) {
            if (!row[1]) return;
            var li = document.createElement('li');
            var strong = document.createElement('strong');
            strong.textContent = row[0] + ': ';
            li.appendChild(strong);
            li.appendChild(document.createTextNode(row[1]));
            details.appendChild(li);
          });
          detailsLoaded = true;
        })
        .catch(function () { details.textContent = ''; var li = document.createElement('li'); li.textContent = 'Contact details are not available right now. You can still send a message below.'; details.appendChild(li); });
    }

    function open() { backdrop.hidden = false; msg.textContent = ''; loadDetails(); form.name.focus(); }
    function close() { backdrop.hidden = true; fab.focus(); }
    function say(text, ok) { msg.textContent = text; msg.style.color = ok ? '#047857' : '#b91c1c'; }

    fab.addEventListener('click', open);
    backdrop.querySelector('#rrms-contact-close').addEventListener('click', close);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !backdrop.hidden) close(); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = { name: form.name.value.trim(), email: form.email.value.trim(), message: form.message.value.trim() };
      if (body.name.length < 2) return say('Please enter your name.', false);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return say('Please enter a valid e-mail address.', false);
      if (body.message.length < 5) return say('Please write a short message (at least 5 characters).', false);
      send.disabled = true; say('Sending...', true);
      fetch(API + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j.success) { say('Thank you. Your message was sent.', true); form.reset(); }
          else say((res.j && res.j.error && res.j.error.message) || 'Could not send the message. Please try again.', false);
        })
        .catch(function () { say('Cannot reach the server. Please try again later.', false); })
        .then(function () { send.disabled = false; });
    });
  }

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
