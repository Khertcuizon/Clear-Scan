# ClearScan OCR

A beginner-friendly, browser-based Optical Character Recognition (OCR) application built with React, TypeScript, Vite, Tailwind CSS v4, and Tesseract.js.

## Features
- Upload PNG, JPG, JPEG, or WEBP images (up to 15 MB)
- Upload PDF documents (up to 50 MB), extract selectable text, and OCR scanned pages
- Preserve line and page breaks in editable PDF text for copying and export
- Capture a document with a webcam (requires localhost or HTTPS and camera permission)
- Recognize English, Spanish, French, German, Italian, Portuguese, Dutch, or Filipino text with Tesseract.js in the browser, individually or with the Auto multilingual setting
- Show a smooth scan beam over the preview and cancel an active scan
- Optionally upscale small images and boost grayscale contrast before recognition
- Detect common objects when no text is found, displaying object names without confidence scores
- Prefer OCR text when an image contains readable text, without mixing in object detections
- Show Tesseract's confidence estimate to help identify results that need review
- Edit text in Times New Roman, copy formatted or plain text, and download TXT or DOCX
- Save up to 50 scan records in browser LocalStorage
- Search, filter scan history from recent scans through one year or a custom date range, reopen, delete individual scans, or clear all history
- Responsive desktop and mobile layout

## Requirements
- Node.js 20.19+ or 22.12+
- npm
- A modern browser

## Setup
1. Extract the project ZIP.
2. Open the `clearscan-ocr` folder in VS Code.
3. Open the integrated terminal in that folder.
4. Install dependencies:

   ```bash
   npm install
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open the local URL printed in the terminal, usually `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

The production website is generated in the `dist` folder.

## How to use
1. Select **Image**, **PDF**, or **Camera** and choose a file or capture a clear picture.
2. Select the document's language and choose whether to enhance images and identify objects.
3. Click **Scan**. PDFs with embedded text are extracted directly; pages without readable text are rendered and OCR'd.
4. Wait for recognition to finish. The first run may take longer because OCR language data and image-recognition models may need to download.
   Use **Cancel scan** to stop an active scan; cancelled results are not saved.
5. Review and edit the result. The confidence value is Tesseract's estimate, not a guarantee of accuracy; always verify important text, especially names and numbers. Use **Copy**, **TXT**, or **DOCX** to save it.
6. Open **History** to reopen or remove previous scans.

## Important notes
- The default OCR language is English (`eng`). The language selector includes `eng`, `spa`, `fra`, `deu`, `ita`, `por`, `nld`, and `fil`, plus Auto, which loads all eight languages together. Language data may need to download the first time each language is used; Auto may take longer and use more memory on its first scan.
- Optional image enhancement upscales smaller images and increases grayscale contrast. It can help with some scans but may not suit every document, so it can be disabled.
- PDF text extraction and OCR run in the browser. The app preserves readable line breaks, but it does not reproduce every PDF font, color, or graphic in the editable text.
- Object detection covers common categories and may not recognize every object or scene. It is an estimate, not a guaranteed identification.
- OCR quality depends on image clarity, lighting, focus, font, and document layout.
- No OCR engine can guarantee 100% accuracy for arbitrary images. The displayed confidence is a recognition-engine estimate, not a percentage guarantee that the text is correct.
- The app does not have a cloud account system or server database. History is stored in the current browser on the current device. Clearing browser storage can remove it.
- Tesseract.js downloads its OCR worker and English language data the first time it is used, so an internet connection is required for the initial OCR setup unless you configure local assets.
- Object detection and fallback image classification download their models the first time they are used.
- Camera access is generally available on `localhost` during development and on HTTPS when deployed.
- This is a client-side starter project. Do not treat browser LocalStorage as secure storage for sensitive documents.

## Project structure

```text
clearscan-ocr/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── README.md
└── src/
    ├── App.tsx       # OCR logic, PDF scanning, camera, history, and interface
    ├── main.tsx      # React entry point
    ├── style.css     # Responsive design and Tailwind import
    └── lib/          # PDF extraction, object recognition, and document export
```
