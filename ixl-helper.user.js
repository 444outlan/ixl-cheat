// ==UserScript==
// @name         IXL Helper (OCR + Canvas Capture)
// @namespace    https://444outlan.github.io/ixl-cheat/
// @version      1.1
// @description  Capture IXL canvas and run in-browser OCR (Tesseract) with cloud fallback option
// @author       444outlan
// @match        *://*.ixl.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.ocr.space
// @connect      444outlan.github.io
// ==/UserScript==

(async function () {
  'use strict';

  console.log("[IXL Helper] OCR script initializing...");

  // --- CONFIG ---
  // If you want the cloud fallback, add your OCR.Space API key here.
  // If you don't want a cloud fallback, leave it as null.
  const OCR_SPACE_API_KEY = null; // <-- put your key string here if desired

  // Tesseract CDN (uses browser-side JS)
  const TESSERACT_CDN = 'https://raw.githubusercontent.com/444outlan/ixl-cheat/main/tesseract.min.js';
  // --- STYLES & UI ---
  GM_addStyle(`
    #ixlHelperBtn { position: fixed; bottom: 15px; right: 15px; padding: 10px 14px; background: #111; color: #fff; border-radius: 9px; cursor: pointer; z-index: 2147483647; font-family: Arial, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
    #ixlHelperBtn:hover { opacity: 0.95; transform: translateY(-1px); }
    #ixlHelperModal { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: 320px; max-width: 760px; background: #fff; color: #111; border-radius: 10px; z-index: 2147483647; box-shadow: 0 20px 60px rgba(0,0,0,.35); padding: 14px; font-family: Arial, sans-serif; display: none; }
    #ixlHelperModal h3 { margin: 0 0 8px 0; font-size: 16px; }
    #ixlHelperModal pre { white-space: pre-wrap; word-break: break-word; max-height: 50vh; overflow: auto; background: #f7f7f7; padding: 10px; border-radius: 6px; }
    #ixlHelperClose { position: absolute; right: 10px; top: 10px; cursor: pointer; color: #666; }
    #ixlHelperSmall { font-size: 12px; color: #666; margin-top: 8px; }
    #ixlHelperRun { margin-top: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; border: none; background: #111; color: white; }
  `);

  // create main button if not present
  if (!document.querySelector('#ixlHelperBtn')) {
    const btn = document.createElement('div');
    btn.id = 'ixlHelperBtn';
    btn.textContent = 'Run IXL Helper';
    document.body.appendChild(btn);
    btn.addEventListener('click', onMainButtonClick);
  }

  // create modal
  if (!document.querySelector('#ixlHelperModal')) {
    const modal = document.createElement('div');
    modal.id = 'ixlHelperModal';
    modal.innerHTML = `
      <span id="ixlHelperClose">✕</span>
      <h3>IXL OCR Result</h3>
      <pre id="ixlHelperResult">No result yet.</pre>
      <div id="ixlHelperSmall">Click <button id="ixlHelperRun">Run OCR now</button> to capture current question. Results appear above.</div>
    `;
    document.body.appendChild(modal);

    document.querySelector('#ixlHelperClose').addEventListener('click', () => { modal.style.display = 'none'; });
    document.querySelector('#ixlHelperRun').addEventListener('click', () => runOCRSequence());
  }

  // convenience
  const modal = () => document.querySelector('#ixlHelperModal');
  const resultPre = () => document.querySelector('#ixlHelperResult');

  // --- Tesseract loader ---
  let TesseractLib = null;
  async function loadTesseract() {
    if (window.Tesseract) { TesseractLib = window.Tesseract; return TesseractLib; }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_CDN;
      s.onload = () => {
        TesseractLib = window.Tesseract;
        console.log('[IXL Helper] Tesseract loaded.');
        resolve(TesseractLib);
      };
      s.onerror = (e) => {
        console.warn('[IXL Helper] Failed to load Tesseract from CDN.', e);
        reject(e);
      };
      document.head.appendChild(s);
    });
  }

  // --- Capture logic ---
  // Attempt to grab a visible canvas; if none found, try to capture bounding box of the question container.
  function findBestCanvas() {
    // Prefer the largest canvas on page (IXL renders text on canvas often)
    const canvases = Array.from(document.querySelectorAll('canvas'));
    if (canvases.length === 0) return null;
    // choose the canvas with the largest area that's visible
    let best = null;
    let bestArea = 0;
    for (const c of canvases) {
      const rect = c.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) { bestArea = area; best = c; }
    }
    return best;
  }

  function captureCanvasDataURL(canvas) {
    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('[IXL Helper] canvas.toDataURL failed', e);
      return null;
    }
  }

  // fallback: screenshot a DOM element using html2canvas if allowed — but we can't load heavy libs. Instead try canvas draw of body.
  function captureViewportAsDataURL() {
    // quick fallback: draw the visible window into a temporary canvas if cross-origin content not blocking
    try {
      const w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
      const h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      // try to draw existing canvases into this canvas (best-effort)
      const canv = findBestCanvas();
      if (canv) {
        const rect = canv.getBoundingClientRect();
        // draw the canvas's pixels onto our temp canvas
        ctx.drawImage(canv, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height);
        return c.toDataURL('image/png');
      }
      // if nothing else, return null
      return null;
    } catch (e) {
      console.warn('[IXL Helper] viewport capture failed', e);
      return null;
    }
  }

  // --- OCR using Tesseract ---
  async function doTesseractOCR(dataURL) {
    if (!dataURL) throw new Error('No image supplied to Tesseract.');
    try {
      await loadTesseract();
      if (!TesseractLib) throw new Error('Tesseract not loaded');
      resultPre().textContent = 'Running Tesseract OCR — please wait...';
      const worker = TesseractLib.createWorker({
        logger: m => {
          // optional logging: show progress in result box
          if (m && m.status && m.progress != null) {
            resultPre().textContent = `Tesseract: ${m.status} ${(m.progress * 100).toFixed(0)}%`;
          }
        }
      });
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      const { data: { text } } = await worker.recognize(dataURL);
      await worker.terminate();
      return text;
    } catch (e) {
      console.error('[IXL Helper] Tesseract OCR failed', e);
      throw e;
    }
  }

  // --- Cloud fallback (OCR.Space) ---
  async function doOcrSpaceOCR(dataURL) {
    if (!OCR_SPACE_API_KEY) throw new Error('No OCR.Space API key configured.');
    // dataURL is like "data:image/png;base64,...."
    const base64 = dataURL.split(',')[1];
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: "https://api.ocr.space/parse/image",
        headers: {
          "apikey": OCR_SPACE_API_KEY,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        data: `base64Image=data:image/png;base64,${base64}&language=eng&isTable=true`,
        onload: function (res) {
          try {
            const json = JSON.parse(res.responseText);
            if (json && json.ParsedResults && json.ParsedResults[0]) {
              resolve(json.ParsedResults[0].ParsedText || '');
            } else {
              reject(new Error('No parsed results from OCR.Space'));
            }
          } catch (err) {
            reject(err);
          }
        },
        onerror: (err) => reject(err)
      });
    });
  }

  // --- Full capture + OCR sequence ---
  async function runOCRSequence() {
    try {
      modal().style.display = 'block';
      resultPre().textContent = 'Locating canvas...';

      let dataURL = null;
      const canvas = findBestCanvas();
      if (canvas) {
        dataURL = captureCanvasDataURL(canvas);
        console.log('[IXL Helper] Captured canvas element for OCR.');
      } else {
        // try viewport fallback
        dataURL = captureViewportAsDataURL();
        console.log('[IXL Helper] Used viewport fallback capture.');
      }

      if (!dataURL) {
        resultPre().textContent = 'Could not capture an image from the page. Make sure the question is visible and not inside a protected iframe.';
        return;
      }

      // Try Tesseract first
      try {
        const text = await doTesseractOCR(dataURL);
        resultPre().textContent = text.trim() || '(Tesseract returned no text)';
        return;
      } catch (tErr) {
        console.warn('[IXL Helper] Tesseract failed — attempting cloud fallback if available', tErr);
        // continue to fallback
      }

      // Fallback to cloud OCR if configured
      if (OCR_SPACE_API_KEY) {
        resultPre().textContent = 'Tesseract failed — using OCR.Space fallback...';
        try {
          const cloudText = await doOcrSpaceOCR(dataURL);
          resultPre().textContent = cloudText.trim() || '(OCR.Space returned no text)';
          return;
        } catch (cErr) {
          resultPre().textContent = 'Cloud OCR failed: ' + (cErr.message || cErr);
          return;
        }
      } else {
        resultPre().textContent = 'Tesseract failed and no cloud fallback is configured. Add your OCR.Space key to the script config if you want the cloud fallback.';
      }
    } catch (err) {
      console.error('[IXL Helper] runOCRSequence error', err);
      resultPre().textContent = 'Error during OCR: ' + (err.message || err);
    }
  }

  // main button click
  function onMainButtonClick() {
    modal().style.display = 'block';
    resultPre().textContent = 'Ready — click "Run OCR now" or press Ctrl+Shift+O to run.';
  }

  // hotkey: Ctrl+Shift+O runs OCR
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'o') {
      runOCRSequence();
    }
  });

  // optional: auto-run when a new question appears using MutationObserver (lightweight)
  let lastCanvasSrc = null;
  function observeForNewCanvas() {
    const obs = new MutationObserver(() => {
      const canv = findBestCanvas();
      let src = null;
      if (canv) {
        try { src = canv.toDataURL(); } catch (e) { src = null; }
      }
      if (src && src !== lastCanvasSrc) {
        lastCanvasSrc = src;
        // do nothing automatically, but update modal text to hint user
        if (modal().style.display !== 'block') {
          resultPre().textContent = 'New question detected. Click Run OCR now.';
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  observeForNewCanvas();

  console.log('[IXL Helper] Ready. Click the helper button and then "Run OCR now". Hotkey: Ctrl+Shift+O');
})();
