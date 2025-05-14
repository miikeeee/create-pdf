// Verwende puppeteer-core und den Community-gepflegten Chrome-Wrapper
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chrome-aws-lambda');

const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// --- Handlebars Helpers (Stelle sicher, dass diese korrekt sind und funktionieren) ---
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
        const execPath = await chromium.executablePath(); // Hole den Pfad
        console.log("Using executablePath from chromium.executablePath():", execPath); // NEUES LOGGING

        if (!execPath) {
            // Versuche einen Fallback oder logge einen detaillierteren Fehler,
            // da chromium.executablePath manchmal auf bestimmten Layern (wie lokal vs. Vercel) anders reagieren kann.
            // Für Vercel sollte chromium.executablePath der primäre Weg sein.
            // Für lokale Entwicklung mit @sparticuz/chrome-aws-lambda (wenn nicht direkt im Lambda-Layer)
            // könnte man PUPPETEER_EXECUTABLE_PATH als Umgebungsvariable setzen.
            console.error("FEHLER: chromium.executablePath() hat keinen Pfad zurückgegeben. Überprüfe die Installation und Umgebung von @sparticuz/chrome-aws-lambda und @sparticuz/chromium-min.");
            // Fallback (hauptsächlich für lokale Tests, wenn execPath von chromium.executablePath() nicht funktioniert):
            // execPath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome-stable');
            // console.log("Verwende Fallback executablePath:", execPath);
            // Für Vercel sollte der obige Fallback nicht nötig sein, wenn die Pakete korrekt installiert sind.
            // Wenn execPath hier leer ist auf Vercel, ist etwas mit den @sparticuz Paketen fundamental falsch.
            throw new Error("Executable path for Chromium could not be determined.");
        }

        console.log("Starte Puppeteer Browser...");
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: execPath, // Verwende den ermittelten Pfad
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });
        console.log("Puppeteer Browser gestartet.");

        const page = await browser.newPage();
        console.log("Neue Seite in Puppeteer erstellt.");

        await page.setContent(renderedHtml, { waitUntil: 'networkidle0' });
        console.log("HTML-Inhalt auf Seite gesetzt.");
        await page.addStyleTag({ content: cssContent });
        console.log("CSS zur Seite hinzugefügt.");

        const footerDate = data.dokument.generierungsdatum || new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const vermieterNameShort = data.vermieter && data.vermieter.name ? data.vermieter.name.substring(0, 30) : 'Vermieter';

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
        // Erfasse den Fehler hier, um ihn spezifischer zu loggen, bevor er weiter oben behandelt wird
        console.error("Fehler beim Starten des Browsers oder PDF-Generierung:", error);
        throw error; // Wirf den Fehler weiter, damit der Handler ihn fangen kann
    } finally {
        if (browser !== null) {
            console.log("Schließe Puppeteer Browser...");
            await browser.close();
            console.log("Puppeteer Browser geschlossen.");
        }
    }
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            const jsonData = req.body;
            if (!jsonData || Object.keys(jsonData).length === 0) {
                console.log("API Aufruf mit leerem oder fehlendem Body.");
                return res.status(400).json({ error: 'Keine Daten im Request Body gefunden oder Body ist leer.' });
            }
            // console.log("Empfangene Daten für PDF-Generierung (Handler):", JSON.stringify(jsonData, null, 2));
            const pdfBuffer = await createPdfFromData(jsonData);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="Nebenkostenabrechnung.pdf"');
            res.send(pdfBuffer);
        } catch (error) {
            // Der Stack Trace sollte jetzt vom spezifischeren Catch-Block in createPdfFromData kommen
            console.error("API Fehler (Handler):", error.stack || error);
            const errorMessage = (process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'development' || process.env.VERCEL_ENV === 'preview')
                                 ? (error.stack || String(error)) : 'Interner Serverfehler bei der PDF-Generierung.';
            res.status(500).json({ error: 'Fehler bei der PDF-Generierung.', details: errorMessage });
        }
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}