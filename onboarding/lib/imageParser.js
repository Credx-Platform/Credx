'use strict';

// Note: Tesseract.js is a client-side library. For server-side use, 
// it requires a worker process and careful setup. This implementation
// assumes a basic Node.js environment setup. For more robust server-side OCR,
// consider a dedicated OCR service or a more complex Tesseract.js setup.

const tesseract = require('tesseract.js');

// Helper function to extract tradeline data from OCR'd text
// This will be very similar to the PDF parser's extractTradelines function,
// but will operate on the text obtained from OCR.
function extractTradelinesFromOcrText(text) {
    const tradelines = [];
    const lines = text.split('\n');
    
    let currentTradeline = null;

    lines.forEach(line => {
        // Reusing the same logic as PDF parser for now, as OCR text structure
        // is expected to be similar to extracted text from PDFs.
        // This highlights the need for a common parsing function.
        
        if (line.match(/\d{1,2}\/\d{1,2}\/\d{4}/) && line.match(/\$\d{1,3}(,\d{3})*(\.\d{2})?/)) {
            if (currentTradeline) {
                tradelines.push(currentTradeline);
            }
            currentTradeline = {
                creditorName: null,
                accountNumber: null,
                accountType: null,
                status: null,
                balance: null,
                dateOpened: null,
                dateFirstDelinquency: null,
                paymentHistory: null,
                isNegative: false,
            };
            const parts = line.split(/\s{2,}/);
            if (parts.length > 0) {
                currentTradeline.creditorName = parts[0]; 
                if (parts.length > 1) {
                    const balanceMatch = line.match(/\$\s?([\d,\.]+)/);
                    if (balanceMatch) {
                        currentTradeline.balance = balanceMatch[1];
                    }
                    const dateMatch = line.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
                    if (dateMatch) {
                        currentTradeline.dateOpened = dateMatch[1]; 
                    }
                }
            }
        } else if (currentTradeline && line.trim() !== '') {
            if (!currentTradeline.accountNumber && line.match(/Account Number[:\s]*\*?\*?\*?\d{4}/)) {
                const accNumMatch = line.match(/\d{4}$/);
                if (accNumMatch) {
                    currentTradeline.accountNumber = `***${accNumMatch[0]}`;
                }
            }
            if (!currentTradeline.status && line.match(/Status[:\s]*(Open|Closed|Charge-off|Collection)/i)) {
                 const statusMatch = line.match(/Status[:\s]*(Open|Closed|Charge-off|Collection)/i);
                 if (statusMatch) {
                    currentTradeline.status = statusMatch[1];
                    if (currentTradeline.status.toLowerCase() === 'charge-off' || currentTradeline.status.toLowerCase() === 'collection') {
                        currentTradeline.isNegative = true;
                    }
                 }
            }
        }
    });

    if (currentTradeline) {
        tradelines.push(currentTradeline);
    }

    return tradelines;
}

// Function to parse an image file using OCR
async function parseImage(filePath) {
    try {
        // Initialize Tesseract.js worker
        // For server-side, it's recommended to create a worker outside this function
        // and reuse it for performance. This is a simplified inline example.
        const worker = tesseract.createWorker({
            logger: m => console.log('[imageParser] Tesseract log:', m),
            // Optionally specify languages if needed, e.g., lang: 'eng+fra'
        });
        await worker.load();
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        
        const { data: { text } } = await worker.recognize(filePath);
        await worker.terminate();

        const tradelines = extractTradelinesFromOcrText(text);
        
        // Basic confidence check - Tesseract.js provides confidence scores per line/word.
        // For simplicity, we'll assume low confidence if OCR text is very short or errors occurred.
        // A real implementation would check confidence scores more granularly.
        const lowConfidence = text.length < 100 || tradelines.length === 0;

        console.log('[imageParser] OCR Extracted text:', text);
        console.log('[imageParser] Extracted tradelines:', tradelines);

        return {
            success: true,
            tradelines: tradelines,
            confidence: lowConfidence ? 'low' : 'high',
            manualReviewNeeded: lowConfidence
        };

    } catch (error) {
        console.error('[imageParser] Error parsing image:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    parseImage
};
