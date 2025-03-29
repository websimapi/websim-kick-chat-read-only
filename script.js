import config from 'config';
// Import connection logic from the new module
import { connectToChannel, closeConnection } from './kick-ws.js';

// Removed: ws, keepAliveInterval variables (managed in kick-ws.js)

let currentChannelName = config.DEFAULT_CHANNEL || ""; // Use default from config initially

const channelInput = document.getElementById('channel-input');
const connectButton = document.getElementById('connect-button');
const messagesContainer = document.getElementById('messages-container');

// Set initial input value
channelInput.value = currentChannelName;

/**
 * Updates the Connect button and input field state.
 * @param {boolean} isConnecting - True if connection attempt is in progress.
 * @param {boolean} isConnected - True if WebSocket is connected and subscribed.
 * @param {string|null} errorReason - Optional reason for disconnection/failure.
 */
function updateUIState(isConnecting, isConnected, errorReason = null) {
    if (isConnecting) {
        connectButton.disabled = true;
        connectButton.textContent = 'Connecting...';
        channelInput.disabled = true; // Disable input during connection attempt
    } else if (isConnected) {
        connectButton.disabled = false;
        connectButton.textContent = 'Disconnect'; // Change button text to Disconnect
        channelInput.disabled = true; // Keep input disabled while connected
    } else { // Disconnected or connection failed
        connectButton.disabled = false;
        connectButton.textContent = 'Connect';
        channelInput.disabled = false; // Enable input when disconnected
        if (errorReason) {
             // Optionally display the error reason near the button or input
             console.log("UI Update - Disconnected/Failed. Reason:", errorReason);
        }
    }
}


/**
 * Displays a message in the chat container.
 * (This function remains in script.js to directly manipulate the DOM)
 * @param {string|null} username - The username of the sender, or null for status/error.
 * @param {string} content - The message content.
 * @param {boolean} [isStatus=false] - True if this is a status message.
 * @param {boolean} [isError=false] - True if this is an error message.
 */
function displayMessage(username, content, isStatus = false, isError = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');

    // Clear potentially conflicting classes first
    messageElement.classList.remove('status-message', 'error-message');

    if (isStatus) {
        messageElement.classList.add('status-message');
        messageElement.textContent = content;
    } else if (isError) {
        messageElement.classList.add('error-message');
        // Use pre-wrap to preserve newlines in multi-line error messages
        messageElement.style.whiteSpace = 'pre-wrap';
        messageElement.textContent = content;
    } else {
        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        usernameSpan.textContent = `${username}:`;

        const contentSpan = document.createElement('span');
        contentSpan.classList.add('content');
        contentSpan.textContent = content; // Use textContent to prevent HTML injection

        messageElement.appendChild(usernameSpan);
        messageElement.appendChild(contentSpan);
    }

    messagesContainer.appendChild(messageElement);
    // Scroll to the bottom only if the user hasn't scrolled up
    // Basic check: if scroll position is close to the bottom before adding message
    const isScrolledToBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 1;
    if (isScrolledToBottom) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// --- Event Listeners ---

connectButton.addEventListener('click', () => {
    // If button says "Disconnect", close the connection
    if (connectButton.textContent === 'Disconnect') {
         console.log("Disconnect button clicked.");
         closeConnection(1000, "User clicked disconnect"); // Request clean disconnect
         // updateUIState will be called by the onclose handler in kick-ws.js
         return; // Don't proceed to connect
    }

    // Otherwise, try to connect
    const newChannelName = channelInput.value.trim().toLowerCase();
    if (newChannelName) {
        currentChannelName = newChannelName;
        channelInput.value = currentChannelName; // Update input field if modified
        messagesContainer.innerHTML = ''; // Clear previous messages before connecting
        connectToChannel(currentChannelName, displayMessage, updateUIState); // Pass callbacks
    } else {
        displayMessage(null, "Please enter a valid channel name.", false, true);
    }
});

channelInput.addEventListener('keypress', function (e) {
    // Only trigger connect on Enter if not already connected or connecting
    if (e.key === 'Enter' && !connectButton.disabled && connectButton.textContent === 'Connect') {
        connectButton.click(); // Simulate button click
    }
});

// --- Initial State ---

// Clear any potential leftover state from page refresh/cache
updateUIState(false, false);

// Display initial message only if no default channel is set or connection fails initially
if (!currentChannelName) {
    displayMessage(null, "Enter a Kick channel name and click Connect.", true);
} else {
     // If there's a default channel, attempt connection on load
     console.log(`Attempting initial connection to default channel: ${currentChannelName}`);
     messagesContainer.innerHTML = ''; // Clear just in case
     connectToChannel(currentChannelName, displayMessage, updateUIState);
}
