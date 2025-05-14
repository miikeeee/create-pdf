// premium-nk-abrechnung/api/generate-pdf.js

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium'); // Importiere das @sparticuz/chromium Paket

const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// --- Handlebars Helpers (bleiben gleich) ---
handlebars.registerHelper('formatCurrency', function (value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value !== 'number') {
        const numValue = parseFloat(String(value).replace(/\./g, '').replace(',', '.'));
        if (isNaN(numValue)) return String(value);
        value = numValue;
    }
    return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

handlebars.registerHelper('formatCurrencyPositive', function (value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value !== 'number') {
        const numValue = parseFloat(String(value).replace(/\./g, '').replace(',', '.'));
        if (isNaN(numValue)) return String(value);
        value = numValue;
    }
    const num = Math.abs(value);
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

handlebars.registerHelper('ne', function (v1, v2) {
    return v1 !== v2;
});

handlebars.registerHelper('gt', function (v1, v2) {
    return v1 > v2;
});
// --- Ende Handlebars Helpers ---


async function createPdfFromData(data) {
    const templateHtmlPath = path.resolve(__dirname, '..', 'templates', 'template-premium.html');
    const cssContentPath = path.resolve(__dirname, '..', 'templates', 'styles-premium.css');

    console.log("Lese HTML Template von:", templateHtmlPath);
    const templateHtml = await fs.readFile(templateHtmlPath, 'utf8');
    console.log("Lese CSS von:", cssContentPath);
    const cssContent = await fs.readFile(cssContentPath, 'utf8');

    const template = handlebars.compile(templateHtml);
    const renderedHtml = template(data);

    let browser = null;

    try {
        // Optional: Fonts laden, falls benötigt (siehe README von @sparticuz/chromium)
        // await chromium.font('https://raw.githack.com/googlei18n/noto-emoji/master/fonts/NotoColorEmoji.ttf');

        console.log("Ermittle executablePath von @sparticuz/chromium...");
        const executablePath = await chromium.executablePath(); // MIT KLAMMERN, laut Doku von @sparticuz/chromium
        console.log("Ermittelter executablePath:", executablePath);

        if (!executablePath) {
            console.error("FEHLER: Konnte keinen gültigen executablePath für Chromium ermitteln mit @sparticuz/chromium.");
            throw new Error("Executable path for Chromium (using @sparticuz/chromium) could not be determined.");
        }

        // Optional: graphicsMode setzen (Standard ist true für WebGL via swiftshader)
        // chromium.setGraphicsMode = false; // Falls du WebGL deaktivieren möchtest

        console.log("Starte Puppeteer Browser mit executablePath:", executablePath);
        browser = await puppeteer.launch({
            args: chromium.args, // Empfohlene Argumente von @sparticuz/chromium
            defaultViewport: chromium.defaultViewport, // Sensible Standard-Viewport-Einstellungen
            executablePath: executablePath,          // Der ermittelte Pfad
            headless: "shell",                       // Empfohlener Headless-Modus für @sparticuz/chromium
            ignoreHTTPSErrors: true,
        });
        console.log("Puppeteer Browser gestartet.");

        const page = await browser.newPage();
        console.log("Neue Seite in Puppeteer erstellt.");

        await page.setContent(renderedHtml, { waitUntil: 'networkidle0' });
        console.log("HTML-Inhalt auf Seite gesetzt.");
        await page.addStyleTag({ content: cssContent });
        console.log("CSS zur Seite hinzugefügt.");

        const footerDate = data.dokument?.generierungsdatum || new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const vermieterNameShort = data.vermieter?.name ? data.vermieter.name.substring(0, 30) : 'Vermieter';

        console.log("Generiere PDF...");
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
            displayHeaderFooter: true,
            footerTemplate: `
                <div style="font-size: 7pt; width: 100%; padding: 0 10mm; box-sizing: border-box; display: flex; justify-content: space-between; color: #777; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                    <span>${vermieterNameShort} - PDF generiert am: ${footerDate}</span>
                    <div>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>
                </div>
            `,
            headerTemplate: '<div style="font-size: 7pt;"></div>'
        });
        console.log("PDF generiert.");
        return pdfBuffer;

    } catch (error) {
        console.error("Fehler beim Starten des Browsers oder PDF-Generierung (in createPdfFromData):", error);
        throw error;
    } finally {
        if (browser !== null) {
            console.log("Schließe Puppeteer Browser...");
            try {
                for (const page of await browser.pages()) {
                   if (!page.isClosed()) await page.close();
                }
                await browser.close();
            } catch (closeError) {
                console.warn("Fehler beim sauberen Schließen des Browsers:", closeError.message);
            }
            console.log("Puppeteer Browser geschlossen (oder Schließversuch unternommen).");
        }
    }
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Nur POST erlaubt.' });
    }
    try {
        const jsonData = req.body;
        if (!jsonData || Object.keys(jsonData).length === 0) {
            return res.status(400).json({ error: 'Keine Daten im Request Body gefunden oder Body ist leer.' });
        }
        const pdfBuffer = await createPdfFromData(jsonData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Nebenkostenabrechnung.pdf"');
        res.send(pdfBuffer);
    } catch (error) {
        console.error("API Fehler (Handler):", error.stack || error);
        const errorMessage = (process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'development' || process.env.VERCEL_ENV === 'preview')
                                 ? (error.stack || String(error)) : 'Interner Serverfehler bei der PDF-Generierung.';
        res.status(500).json({ error: 'Fehler bei der PDF-Generierung.', details: errorMessage });
    }
}