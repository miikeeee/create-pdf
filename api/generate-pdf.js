const PDFDocument = require('pdfkit');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Nur POST erlaubt.' });
    }

    try {
        const jsonData = req.body;
        if (!jsonData || Object.keys(jsonData).length === 0) {
            return res.status(400).json({ error: 'Keine Daten im Request Body gefunden oder Body ist leer.' });
        }

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        let buffers = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            const pdfData = Buffer.concat(buffers);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="dokument.pdf"');
            res.send(pdfData);
        });

        // Beispielinhalt basierend auf deinen JSON-Daten
        doc.fontSize(20).text('Dein PDF-Dokument', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Vermieter: ${jsonData.vermieter?.name || 'Unbekannt'}`);
        doc.text(`Generiert am: ${jsonData.dokument?.generierungsdatum || new Date().toLocaleDateString()}`);
        doc.moveDown();

        doc.text('Datenübersicht:', { underline: true });
        doc.text(JSON.stringify(jsonData, null, 2));

        doc.end();

    } catch (error) {
        console.error("❌ Fehler bei der PDF-Generierung:", error);
        res.status(500).json({ error: 'Fehler bei der PDF-Generierung.', details: error.stack || error.toString() });
    }
}
