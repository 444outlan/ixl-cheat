// ==UserScript==
// @name         IXL Helper (GitHub Hosted)
// @namespace    https://444outlan.github.io/ixl-cheat/
// @version      1.0
// @description  Base script hosted on GitHub Pages for future OCR + AI features
// @author       444outlan
// @match        *://*.ixl.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      444outlan.github.io
// ==/UserScript==

(async function() {
  'use strict';

  console.log("[IXL Helper] Loaded from GitHub Pages ✅");

  // small style example
  GM_addStyle(`
    #ixlHelperBtn {
      position: fixed;
      bottom: 15px;
      right: 15px;
      padding: 10px 15px;
      background: #333;
      color: #fff;
      border-radius: 8px;
      cursor: pointer;
      z-index: 99999;
      font-family: Arial, sans-serif;
    }
    #ixlHelperBtn:hover {
      background: #555;
    }
  `);

  // add a lil button on screen
  const btn = document.createElement('div');
  btn.id = 'ixlHelperBtn';
  btn.textContent = 'Run IXL Helper';
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    alert("IXL Helper connected! GitHub host active.");
  });

})();
