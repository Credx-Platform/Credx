'use strict';

const pdfParse = require('pdf-parse');

// Helper function to extract tradeline data from parsed PDF text
// This is a simplified regex-based approach and may need refinement for different PDF formats.
function extractTradelines(text) {
    const tradelines = [];
    // Basic regex to find potential tradeline entries. This will need significant improvement.
    // Example: Looking for lines that contain account names, numbers, balances, and dates.
    const lines = text.split('\n');
    
    let currentTradeline = null;

    lines.forEach(line => {
        // Very basic pattern matching. Real-world parsing would require more robust logic
        // to identify account names, numbers, statuses, balances, dates etc.
        // This is a placeholder to demonstrate the concept.
        
        // Example: Trying to identify lines that look like account summaries
        if (line.match(/\d{1,2}\/\d{1,2}\/\d{4}/) && line.match(/\$\d{1,3}(,\d{3})*(\.\d{2})?/)) {
            // If we have a current tradeline, push it before starting a new one
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
            // Attempt to parse some fields - highly dependent on PDF structure
            const parts = line.split(/\s{2,}/); // Split by multiple spaces
            if (parts.length > 0) {
                currentTradeline.creditorName = parts[0]; // Assumption: first part is creditor name
                if (parts.length > 1) {
                    // Attempt to find balance
                    const balanceMatch = line.match(/\$\s?([\d,\.]+)/);
                    if (balanceMatch) {
                        currentTradeline.balance = balanceMatch[1];
                    }
                    // Attempt to find dates
                    const dateMatch = line.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
                    if (dateMatch) {
                        currentTradeline.dateOpened = dateMatch[1]; // Assumption: first date found is open date
                    }
                }
            }
        } else if (currentTradeline && line.trim() !== '') {
            // Continue parsing fields for the current tradeline if it's not empty
            // This part would involve more complex logic to identify specific fields like account number, status, etc.
            // For example, looking for keywords like 'Account Number:', 'Status:', 'Delinquency Date:'
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
            // Add more logic here for other fields like 'Date Opened', 'Payment History', etc.
        }
    });

    // Add the last processed tradeline if it exists
    if (currentTradeline) {
        tradelines.push(currentTradeline);
    }

    return tradelines;
}

// Function to parse a PDF file
async function parsePdf(filePath) {
    try {
        const dataBuffer = require('fs').readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        const text = data.text;
        const tradelines = extractTradelines(text);
        
        // Simulate saving to database - replace with actual DB calls
        console.log('[pdfParser] Extracted tradelines:', tradelines);
        return { success: true, tradelines: tradelines };

    } catch (error) {
        console.error('[pdfParser] Error parsing PDF:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    parsePdf
};
