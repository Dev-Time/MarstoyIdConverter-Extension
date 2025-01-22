// Listener for messages from the popup
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'convert') {
        // Query the active tab in the current window
        browser.tabs.query({ active: true, currentWindow: true })
            .then((tabs) => {
                if (tabs[0] && tabs[0].id) {
                    // Send a message to the content script in the active tab
                    return browser.tabs.sendMessage(tabs[0].id, { action: 'convert' });
                } else {
                    throw new Error('No active tab found.');
                }
            })
            .then((response) => {
                sendResponse(response);
            })
            .catch((error) => {
                console.error('Error in background service worker:', error);
                sendResponse({ status: error.message || 'Update failed.' });
            });
        
        // Indicate that the response will be sent asynchronously
        return true;
    }
});
