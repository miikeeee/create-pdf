// Verwende puppeteer-core und den Community-gepflegten Chrome-Wrapper
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chrome-aws-lambda'); // Geänderter Import

const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// --- Handlebars Helpers (Stelle sicher, dass diese korrekt sind und funktionieren) ---
handlebars.registerHelper('formatCurrency', function (value) {
    if (value === null || typeof value === 'undefined') return '';
    if (typeof value !== 'number') {
        const numValue = parseFloat(String(value).replace(/\./g, '').replace(',', '.')); // Tausenderpunkte entfernen, Komma zu Punkt
        if (isNaN(numValue)) return String(value); // Gib Original-String zurück, wenn Konvertierung fehlschlägt
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

    const templateHtml = await fs.readFile(templateHtmlPath, 'utf8');
    const cssContent = await fs.readFile(cssContentPath, 'utf8');

    const template = handlebars.compile(templateHtml);
    const renderedHtml = template(data);

    let browser = null;

    try {
        // Konfiguration für Puppeteer mit @sparticuz/chrome-aws-lambda
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(), // Wichtig: mit Klammern () aufrufen!
            headless: chromium.headless, // Stellt sicher, dass es headless läuft
            ignoreHTTPSErrors: true, // Kann nützlich sein, wenn lokale Ressourcen geladen werden
        });

        const page = await browser.newPage();

        await page.setContent(renderedHtml, { waitUntil: 'networkidle0' });
        await page.addStyleTag({ content: cssContent });

        const footerDate = data.dokument.generierungsdatum || new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const vermieterNameShort = data.vermieter && data.vermieter.name ? data.vermieter.name.substring(0, 30) : 'Vermieter';

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
        return pdfBuffer;
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            const jsonData = req.body;
            if (!jsonData || Object.keys(jsonData).length === 0) {
                return res.status(400).json({ error: 'Keine Daten im Request Body gefunden oder Body ist leer.' });
            }
            // console.log("Empfangene Daten für PDF-Generierung:", JSON.stringify(jsonData, null, 2)); // Für Debugging
            const pdfBuffer = await createPdfFromData(jsonData);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="Nebenkostenabrechnung.pdf"');
            res.send(pdfBuffer);
        } catch (error) {
            console.error("API Fehler bei der PDF-Generierung:", error.stack); // Logge den Stack Trace für bessere Fehlersuche
            const errorMessage = (process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'development')
                                 ? error.stack : 'Interner Serverfehler bei der PDF-Generierung.';
            res.status(500).json({ error: 'Fehler bei der PDF-Generierung.', details: errorMessage });
        }
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}