// Verwende puppeteer-core und den Community-gepflegten Chrome-Wrapper
const chromium = require('@sparticuz/chromium-min'); // Oder 'chrome-aws-lambda'
const puppeteer = require('puppeteer-core'); // Wichtig: puppeteer-core verwenden!

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
    let browser = null;
    try {
        const executablePath = process.env.AWS_LAMBDA_FUNCTION_VERSION
            ? await chromium.executablePath() // Für neuere @sparticuz/chromium
            // Falls die obige Zeile nicht geht, oder für ältere/andere Pakete:
            // const executablePath = await chromium.executablePath; // Beachte: kein ()
            : puppeteer.executablePath(); // Fallback für lokale Entwicklung (wenn voller puppeteer installiert ist)


        console.log('Using executablePath:', executablePath);

        browser = await puppeteer.launch({
            args: chromium.args,
            executablePath: executablePath, // Hier die aufgelöste Variable verwenden
            headless: chromium.headless,     // Oder true für neuere @sparticuz/chromium
            // Ggf. weitere Flags für Sandbox-Probleme in Lambda:
            // defaultViewport: chromium.defaultViewport,
            // ignoreHTTPSErrors: true,
        });

        // ... Rest deiner PDF-Generierungslogik ...

    } catch (error) {
        console.error("Fehler beim Starten des Browsers oder PDF-Generierung:", error);
        // Stelle sicher, dass der Fehler weitergeworfen oder behandelt wird
        throw new Error(`API Fehler bei der PDF-Generierung: ${error.message}`);
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