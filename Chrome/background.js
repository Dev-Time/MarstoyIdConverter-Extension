// Listener for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'convert') {
      // Query the active tab in the current window
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          // Send a message to the content script in the active tab
          chrome.tabs.sendMessage(tabs[0].id, { action: 'convert' }, (response) => {
            if (chrome.runtime.lastError) {
              // Handle error if the content script is not loaded
              sendResponse({ status: 'Update failed: Content script not found.' });
            } else {
              sendResponse(response);
            }
          });
        } else {
          sendResponse({ status: 'Update failed: No active tab found.' });
        }
      });
      // Indicate that the response will be sent asynchronously
      return true;
    }
  });
  