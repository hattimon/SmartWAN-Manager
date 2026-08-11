import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Languages, Loader2, Printer, QrCode, RotateCcw, X } from 'lucide-react';
import QRCode from 'qrcode';

import {
  detectedPanelAddress,
  HOME_POSTER_HEIGHT,
  HOME_POSTER_WIDTH,
  normalizePanelAddress,
} from './homePoster.js';

const posterTemplateUrl = `${import.meta.env.BASE_URL}assets/smartwan-home-poster-template.png`;
const posterQrSize = 346;
const posterQrPanel = { x: 181, y: 709, width: 412, height: 392 };

const uiCopy = {
  en: {
    open: 'Create a QR poster for the home panel',
    title: 'Home panel QR poster',
    copy: 'Generate the complete SmartWAN graphic with an address detected from this page or entered manually.',
    posterLanguage: 'Poster language',
    panelAddress: 'Alternative panel address (optional)',
    addressHint: 'Leave empty to use the detected address, or enter an address with a port / complete HTTP(S) URL.',
    detected: 'Detected from this page',
    useDetected: 'Use detected address',
    encodedAddress: 'The QR code opens',
    privacy: 'The QR code and poster are generated locally in your browser.',
    preview: 'Poster preview',
    generating: 'Generating poster…',
    invalidAddress: 'Enter a valid HTTP/HTTPS panel address.',
    download: 'Download PNG',
    print: 'Print poster',
    close: 'Close poster generator',
  },
  pl: {
    open: 'Utwórz plakat QR panelu domowego',
    title: 'Plakat QR panelu domowego',
    copy: 'Wygeneruj kompletną grafikę SmartWAN z adresem wykrytym z tej strony lub wpisanym ręcznie.',
    posterLanguage: 'Język plakatu',
    panelAddress: 'Alternatywny adres panelu (opcjonalnie)',
    addressHint: 'Zostaw puste, aby użyć wykrytego adresu, albo wpisz adres z portem / pełny URL HTTP(S).',
    detected: 'Wykryto z tej strony',
    useDetected: 'Użyj wykrytego adresu',
    encodedAddress: 'Kod QR otwiera',
    privacy: 'Kod QR i plakat są generowane lokalnie w przeglądarce.',
    preview: 'Podgląd plakatu',
    generating: 'Generowanie plakatu…',
    invalidAddress: 'Wpisz prawidłowy adres panelu HTTP/HTTPS.',
    download: 'Pobierz PNG',
    print: 'Drukuj plakat',
    close: 'Zamknij generator plakatu',
  },
};

const posterText = {
  en: {
    status: 'Internet is running great! All WANs are purring 🐱',
    tagline: 'Your home. Your network. Full control.',
    information: [
      [{ text: 'Current internet ' }, { text: 'status', color: '#93f878' }],
      [{ text: 'and ' }, { text: 'configuration', color: '#93f878' }, { text: ' or ' }, { text: 'outage', color: '#93f878' }],
      [{ text: 'details are in the panel' }],
    ],
    scan: ['Scan the code,', 'to open the', 'home panel'],
    footer: 'For our home, always online.',
  },
};

let posterImagePromise;

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function loadPosterImage() {
  if (!posterImagePromise) {
    posterImagePromise = loadImage(posterTemplateUrl);
  }
  return posterImagePromise;
}

function roundedRect(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function fittedFontSize(ctx, text, maxWidth, maxSize, minSize, weight = 800) {
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `${weight} ${size}px Arial, "Segoe UI", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return minSize;
}

function drawCenteredLine(ctx, text, centerX, y, maxWidth, options = {}) {
  const {
    color = '#f5f5f1',
    maxSize = 38,
    minSize = 20,
    weight = 800,
    glow = '',
  } = options;
  const size = fittedFontSize(ctx, text, maxWidth, maxSize, minSize, weight);
  ctx.font = `${weight} ${size}px Arial, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = glow;
  ctx.shadowBlur = glow ? 10 : 0;
  ctx.fillText(text, centerX, y);
  ctx.shadowBlur = 0;
}

function drawCenteredSegments(ctx, segments, centerX, y, maxWidth) {
  const joined = segments.map((segment) => segment.text).join('');
  const size = fittedFontSize(ctx, joined, maxWidth, 39, 26, 800);
  ctx.font = `800 ${size}px Arial, "Segoe UI", sans-serif`;
  const totalWidth = segments.reduce((sum, segment) => sum + ctx.measureText(segment.text).width, 0);
  let x = centerX - totalWidth / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 5;
  segments.forEach((segment) => {
    ctx.fillStyle = segment.color || '#f5f5f1';
    ctx.fillText(segment.text, x, y);
    x += ctx.measureText(segment.text).width;
  });
  ctx.shadowBlur = 0;
}

function drawEnglishCopy(ctx) {
  const copy = posterText.en;

  roundedRect(ctx, 244, 77, 642, 62, 31, 'rgba(5, 23, 28, 0.98)');
  drawCenteredLine(ctx, copy.status, 565, 108, 610, {
    color: '#9bf77b',
    maxSize: 28,
    minSize: 21,
    glow: 'rgba(77, 255, 105, 0.65)',
  });

  roundedRect(ctx, 275, 344, 575, 58, 6, 'rgba(3, 20, 25, 0.98)');
  drawCenteredLine(ctx, copy.tagline, 562, 376, 550, {
    color: '#91a6ae',
    maxSize: 29,
    minSize: 22,
    weight: 700,
  });

  roundedRect(ctx, 126, 493, 522, 176, 18, 'rgba(5, 25, 30, 0.99)');
  copy.information.forEach((line, index) => {
    drawCenteredSegments(ctx, line, 387, 535 + index * 52, 490);
  });

  roundedRect(ctx, 742, 548, 276, 151, 32, 'rgba(5, 24, 29, 0.99)');
  copy.scan.forEach((line, index) => {
    drawCenteredLine(ctx, line, 880, 583 + index * 43, 252, {
      color: index === 0 ? '#9bf77b' : '#f4f2eb',
      maxSize: 34,
      minSize: 24,
      glow: index === 0 ? 'rgba(77, 255, 105, 0.4)' : '',
    });
  });

  roundedRect(ctx, 300, 1317, 535, 49, 10, 'rgba(3, 20, 25, 0.98)');
  drawCenteredLine(ctx, `♥  ${copy.footer}`, 568, 1342, 500, {
    color: '#8399a0',
    maxSize: 26,
    minSize: 19,
    weight: 700,
  });
}

function drawAddress(ctx, address) {
  roundedRect(ctx, 321, 1224, 585, 74, 16, 'rgba(4, 24, 29, 0.99)');
  drawCenteredLine(ctx, address, 614, 1262, 548, {
    color: '#9bfa76',
    maxSize: 45,
    minSize: 21,
    glow: 'rgba(82, 255, 99, 0.5)',
  });
}

async function renderPoster(canvas, normalizedAddress, language) {
  const [template, qrImage] = await Promise.all([
    loadPosterImage(),
    QRCode.toDataURL(normalizedAddress.href, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: posterQrSize,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(loadImage),
    document.fonts?.ready,
  ]);
  const ctx = canvas.getContext('2d');
  canvas.width = HOME_POSTER_WIDTH;
  canvas.height = HOME_POSTER_HEIGHT;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(template, 0, 0, HOME_POSTER_WIDTH, HOME_POSTER_HEIGHT);

  if (language === 'en') {
    drawEnglishCopy(ctx);
  }

  roundedRect(
    ctx,
    posterQrPanel.x,
    posterQrPanel.y,
    posterQrPanel.width,
    posterQrPanel.height,
    18,
    '#ffffff',
  );
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    qrImage,
    posterQrPanel.x + (posterQrPanel.width - posterQrSize) / 2,
    posterQrPanel.y + (posterQrPanel.height - posterQrSize) / 2,
    posterQrSize,
    posterQrSize,
  );
  ctx.imageSmoothingEnabled = true;
  drawAddress(ctx, normalizedAddress.display);
}

function downloadCanvas(canvas, language) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `smartwan-home-panel-${language}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }, 'image/png');
}

function printCanvas(canvas, title) {
  const imageUrl = canvas.toDataURL('image/png');
  const frame = document.createElement('iframe');
  frame.className = 'home-poster-print-frame';
  frame.title = title;
  document.body.appendChild(frame);
  const printDocument = frame.contentDocument;
  printDocument.open();
  printDocument.write(`<!doctype html><html><head><title>${title}</title><style>
    @page { margin: 0; }
    html, body { width: 100%; height: 100%; margin: 0; background: #fff; }
    body { display: grid; place-items: center; }
    img { display: block; width: 100%; height: 100%; object-fit: contain; }
  </style></head><body><img alt="${title}" src="${imageUrl}"></body></html>`);
  printDocument.close();
  const printImage = printDocument.querySelector('img');
  printImage.addEventListener('load', () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    window.setTimeout(() => frame.remove(), 1500);
  }, { once: true });
}

export default function HomePosterGenerator({ language }) {
  const detectedAddress = useMemo(() => detectedPanelAddress(window.location), []);
  const [open, setOpen] = useState(false);
  const [posterLanguage, setPosterLanguage] = useState(language === 'pl' ? 'pl' : 'en');
  const [addressInput, setAddressInput] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const canvasRef = useRef(null);
  const panelCopy = uiCopy[language === 'pl' ? 'pl' : 'en'];
  const copy = uiCopy[posterLanguage];

  const normalizedAddress = useMemo(() => {
    try {
      return normalizePanelAddress(addressInput.trim() || detectedAddress);
    } catch {
      return null;
    }
  }, [addressInput, detectedAddress]);

  useEffect(() => {
    if (!open) setPosterLanguage(language === 'pl' ? 'pl' : 'en');
  }, [language, open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !normalizedAddress || !canvasRef.current) return undefined;
    let cancelled = false;
    setRendering(true);
    setRenderError('');
    renderPoster(canvasRef.current, normalizedAddress, posterLanguage)
      .catch(() => {
        if (!cancelled) setRenderError(copy.invalidAddress);
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.invalidAddress, normalizedAddress, open, posterLanguage]);

  const modal = open ? (
    <div className="home-poster-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <section className="home-poster-modal" role="dialog" aria-modal="true" aria-labelledby="home-poster-title">
        <header className="home-poster-modal-header">
          <div>
            <span className="home-poster-eyebrow"><QrCode size={17} /> SmartWAN Manager</span>
            <h2 id="home-poster-title">{copy.title}</h2>
            <p>{copy.copy}</p>
          </div>
          <button type="button" className="home-poster-close" onClick={() => setOpen(false)} aria-label={copy.close} title={copy.close}>
            <X size={21} />
          </button>
        </header>

        <div className="home-poster-modal-content">
          <div className="home-poster-controls">
            <div className="home-poster-control-label">
              <span><Languages size={16} />{copy.posterLanguage}</span>
              <span className="home-poster-language-toggle">
                <button type="button" className={posterLanguage === 'pl' ? 'active' : ''} onClick={() => setPosterLanguage('pl')}>Polski</button>
                <button type="button" className={posterLanguage === 'en' ? 'active' : ''} onClick={() => setPosterLanguage('en')}>English</button>
              </span>
            </div>

            <label className="home-poster-control-label">
              <span><QrCode size={16} />{copy.panelAddress}</span>
              <input
                type="text"
                value={addressInput}
                onChange={(event) => setAddressInput(event.target.value)}
                spellCheck="false"
                autoComplete="url"
                aria-invalid={!normalizedAddress}
                placeholder={normalizePanelAddress(detectedAddress).display}
              />
              <small>{normalizedAddress ? copy.addressHint : copy.invalidAddress}</small>
            </label>

            <div className="home-poster-detected">
              <span><strong>{copy.detected}</strong><small>{normalizePanelAddress(detectedAddress).display}</small></span>
              <button type="button" onClick={() => setAddressInput('')} disabled={!addressInput}>
                <RotateCcw size={15} />{copy.useDetected}
              </button>
            </div>

            <div className="home-poster-encoded-address">
              <span>{copy.encodedAddress}</span>
              <strong>{normalizedAddress?.href || '—'}</strong>
            </div>
            <p className="home-poster-privacy"><QrCode size={16} />{copy.privacy}</p>

            <div className="home-poster-actions">
              <button
                type="button"
                className="action primary"
                disabled={rendering || !normalizedAddress || Boolean(renderError)}
                onClick={() => downloadCanvas(canvasRef.current, posterLanguage)}
              >
                <Download size={17} />{copy.download}
              </button>
              <button
                type="button"
                className="action secondary"
                disabled={rendering || !normalizedAddress || Boolean(renderError)}
                onClick={() => printCanvas(canvasRef.current, copy.title)}
              >
                <Printer size={17} />{copy.print}
              </button>
            </div>
          </div>

          <div className="home-poster-preview" aria-busy={rendering}>
            <span className="home-poster-preview-label">{copy.preview}</span>
            <canvas ref={canvasRef} role="img" aria-label={copy.preview} />
            {rendering ? <div className="home-poster-rendering"><Loader2 className="spin" />{copy.generating}</div> : null}
            {renderError ? <div className="notice error">{renderError}</div> : null}
          </div>
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="home-poster-trigger"
        onClick={() => setOpen(true)}
        aria-label={panelCopy.open}
        title={panelCopy.open}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <QrCode size={27} />
      </button>
      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}
