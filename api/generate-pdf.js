// premium-nk-abrechnung/api/generate-pdf.js

const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// --- Handlebars Helpers (kopiere sie von deiner lokalen generate-pdf-premium.js hierher) ---
handlebars.registerHelper('formatCurrency', function (value) { /* ... deine Implementierung ... */ });
handlebars.registerHelper('formatCurrencyPositive', function (value) { /* ... deine Implementierung ... */ });
handlebars.registerHelper('ne', function (v1, v2) { /* ... deine Implementierung ... */ });
handlebars.registerHelper('gt', function (v1, v2) { /* ... deine Implementierung ... */ });
// Stelle sicher, dass alle Helper hier sind!


// Die eigentliche PDF-Erstellungslogik, jetzt als separate Funktion
async function createPdfFromData(data) {
    // Pfade zu den Templates müssen relativ zum Ort dieser Datei sein, wenn sie im Vercel Build liegen
    // oder absolut, wenn sie woanders im Deployment-Paket sind.
    // __dirname zeigt auf den 'api'-Ordner in der Vercel-Umgebung.
    const templateHtmlPath = path.resolve(__dirname, '..', 'templates', 'template-premium.html');
    const cssContentPath = path.resolve(__dirname, '..', 'templates', 'styles-premium.css');

    const templateHtml = await fs.readFile(templateHtmlPath, 'utf8');
    const cssContent = await fs.readFile(cssContentPath, 'utf8');

    const template = handlebars.compile(templateHtml);
    const renderedHtml = template(data); // 'data' kommt jetzt als Parameter

    let browser;
    try {
        // Wichtige Optionen für Puppeteer in Serverless-Umgebungen:
        // Chromium wird von Vercel bereitgestellt oder du nutzt puppeteer-core mit chrome-aws-lambda
        // Für den Anfang mit dem vollen 'puppeteer'-Paket:
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Wichtig für Umgebungen mit begrenztem /dev/shm
                '--single-process'         // Manchmal hilfreich bei Ressourcenknappheit
            ],
            // executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined // Für fortgeschrittene Setups mit eigenem Chromium
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
            headerTemplate: '<div style="font-size: 7pt;"></div>' // Muss vorhanden sein, wenn displayHeaderFooter true ist
        });
        return pdfBuffer;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Der Vercel Serverless Function Handler
export default async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            const jsonData = req.body; // Vercel parst JSON-Bodies automatisch

            if (!jsonData || Object.keys(jsonData).length === 0) {
                return res.status(400).json({ error: 'Keine Daten im Request Body gefunden oder Body ist leer.' });
            }

            console.log("Empfangene Daten für PDF-Generierung:", JSON.stringify(jsonData, null, 2)); // Für Debugging

            const pdfBuffer = await createPdfFromData(jsonData);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="Nebenkostenabrechnung.pdf"');
            res.send(pdfBuffer);

        } catch (error) {
            console.error("API Fehler bei der PDF-Generierung:", error);
            // Sende detailliertere Fehlermeldung im Entwicklungsmodus
            const errorMessage = process.env.NODE_ENV === 'development' ? error.stack : 'Interner Serverfehler bei der PDF-Generierung.';
            res.status(500).json({ error: 'Fehler bei der PDF-Generierung.', details: errorMessage });
        }
    } else {
        // Nur POST-Requests erlauben
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}