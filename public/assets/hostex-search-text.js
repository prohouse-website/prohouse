/*
 * ProHouse direct booking: label the existing Hostex search action.
 * Hostex creates its clickable control inside an open shadow root.
 * Do not replace or proxy the native click; dates, guest state and navigation stay in Hostex.
 */
(() => {
  'use strict';
  const widget = document.querySelector('.refresh-search hostex-search-widget');
  if (!widget) return;

  const widgetStyles = `
    bs-main-search-bar-desktop .ph-search-native {
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      gap:6px!important;
      min-width:100px!important;
      width:auto!important;
      height:44px!important;
      padding:0 18px!important;
      background:#ff5a12!important;
      border:1px solid #ff5a12!important;
      border-radius:8px!important;
      color:#fff!important;
      font:700 16px/1 'DM Sans',Arial,sans-serif!important;
      letter-spacing:.01em!important;
    }
    bs-main-search-bar-desktop .ph-search-native > svg {display:none!important}
    bs-main-search-bar-desktop .ph-search-wrap {cursor:pointer!important}
    bs-main-search-bar-desktop .ph-search-wrap:focus-visible {outline:3px solid #20251e!important;outline-offset:3px!important}
    bs-main-search-bar-desktop .ph-search-label {display:inline-block!important;pointer-events:none!important}
    @media (max-width:700px) {
      bs-main-search-bar-desktop > div {
        height:auto!important;
        flex-wrap:wrap!important;
        row-gap:5px!important;
      }
      bs-main-search-bar-desktop > div > .ph-search-wrap {
        flex:0 0 100%!important;
        width:100%!important;
        padding:8px 0 0!important;
        align-self:stretch!important;
      }
      bs-main-search-bar-desktop .ph-search-native {
        width:100%!important;
        height:46px!important;
        min-width:0!important;
      }
    }
  `;

  let observedRoot = null;
  let observer = null;
  const enhance = () => {
    const root = widget.shadowRoot;
    if (!root) return false;
    if (root !== observedRoot) {
      observer?.disconnect();
      observedRoot = root;
      observer = new MutationObserver(enhance);
      observer.observe(root, {childList: true, subtree: true});
    }
    if (!root.querySelector('style[data-prohouse-search]')) {
      const style = document.createElement('style');
      style.dataset.prohouseSearch = 'true';
      style.textContent = widgetStyles;
      root.appendChild(style);
    }
    const nativeControl = root.querySelector('bs-main-search-bar-desktop .btn-effect');
    if (!nativeControl) return false;

    nativeControl.classList.add('ph-search-native');
    const clickable = nativeControl.parentElement;
    if (clickable) {
      clickable.classList.add('ph-search-wrap');
      clickable.setAttribute('role', 'button');
      clickable.setAttribute('tabindex', '0');
      clickable.setAttribute('aria-label', 'Search available rooms');
      if (!clickable.dataset.prohouseKeyboard) {
        clickable.dataset.prohouseKeyboard = 'true';
        clickable.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            clickable.click();
          }
        });
      }
    }
    if (!nativeControl.querySelector('.ph-search-label')) {
      const label = document.createElement('span');
      label.className = 'ph-search-label';
      label.textContent = 'Search';
      nativeControl.appendChild(label);
    }
    return true;
  };

  // Angular hydrates after the host page; a short-lived poll discovers the shadow root.
  enhance();
  const poll = setInterval(enhance, 300);
  setTimeout(() => clearInterval(poll), 30000);
})();