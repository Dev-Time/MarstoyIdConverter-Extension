document.addEventListener('DOMContentLoaded', function () {
    const statusText = document.getElementById('status-text');
    const convertBtn = document.getElementById('convert-btn');

    // Function to update the status text
    function updateStatus(message) {
        statusText.textContent = message;
    }

    // Handle the Convert button click
    convertBtn.addEventListener('click', function () {
        updateStatus('Updating...');

        // Send a message to the background service worker to initiate conversion
        browser.runtime.sendMessage({ action: 'convert' })
            .then((response) => {
                if (response && response.status) {
                    updateStatus(response.status);
                } else {
                    updateStatus('Update failed.');
                }
            })
            .catch((error) => {
                console.error('Error sending message to background:', error);
                updateStatus('Update failed.');
            });
    });
});
