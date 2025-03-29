import config from 'config';

let ws = null;
let keepAliveInterval = null;
let channelName = config.DEFAULT_CHANNEL; // Use default from config initially

const channelInput = document.getElementById('channel-input');
const connectButton = document.getElementById('connect-button');
const messagesContainer = document.getElementById('messages-container');

// Set initial input value
channelInput.value = channelName;

function displayMessage(username, content, isStatus = false, isError = false) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');

    // Clear status/error classes if it's a regular message
    messageElement.classList.remove('status-message', 'error-message');

    if (isStatus) {
        messageElement.classList.add('status-message');
        // Use textContent for safety, even for status messages
        messageElement.textContent = content;
    } else if (isError) {
        messageElement.classList.add('error-message');
        messageElement.textContent = content;
    } else {
        const usernameSpan = document.createElement('span');
        usernameSpan.classList.add('username');
        usernameSpan.textContent = `${username}:`;

        const contentSpan = document.createElement('span');
        contentSpan.classList.add('content');
        // Basic HTML entity escaping for security
        contentSpan.textContent = content; // Use textContent to prevent HTML injection

        messageElement.appendChild(usernameSpan);
        messageElement.appendChild(contentSpan);
    }

    messagesContainer.appendChild(messageElement);
    // Scroll to the bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function connectWebSocket(channel) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("Closing existing WebSocket connection.");
        ws.close();
    }
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
    messagesContainer.innerHTML = ''; // Clear previous messages
    displayMessage(null, `Connecting to ${channel}...`, true);
    connectButton.disabled = true; // Disable button during connection attempt
    connectButton.textContent = 'Connecting...';

    // Fetch channel ID and pusher details
    fetch(`https://kick.com/api/v2/channels/${channel}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch channel data (Status: ${response.status})`);
            }
            return response.json();
        })
        .then(data => {
            if (!data || !data.chatroom || !data.chatroom.id) {
                throw new Error(`Could not find chatroom for channel: ${channel}`);
            }
            if (!data.chatroom.pusher_details || !data.chatroom.pusher_details.host || !data.chatroom.pusher_details.key) {
                throw new Error(`Could not retrieve required Pusher connection details for ${channel}.`);
            }

            const chatroomId = data.chatroom.id;
            const pusherKey = data.chatroom.pusher_details.key;
            const pusherHost = data.chatroom.pusher_details.host;
            const pusherCluster = data.chatroom.pusher_details.cluster; // Extract cluster if available, might be useful

            console.log(`Found chatroom ID: ${chatroomId}`);
            console.log(`Using Pusher Key: ${pusherKey}, Host: ${pusherHost}, Cluster: ${pusherCluster}`);

            // Construct the WebSocket URL using fetched details
            const wsUrl = `wss://${pusherHost}/app/${pusherKey}?protocol=7&client=js&version=7.6.0&flash=false`;
            console.log("Attempting to connect to:", wsUrl);

            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log("Connected to Kick chat WebSocket.");
                displayMessage(null, `Connected to ${channel}.`, true);
                connectButton.disabled = false;
                connectButton.textContent = 'Connect';

                ws.send(JSON.stringify({
                    event: "pusher:subscribe",
                    data: {
                        auth: "",
                        channel: `chatrooms.${chatroomId}.v2`
                        // channel: `private-chatrooms.${chatroomId}` // Alternative channel format sometimes seen
                    }
                }));

                // Send ping every 30 seconds to keep connection alive
                keepAliveInterval = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        // console.log("Sending ping");
                        ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
                    } else {
                        clearInterval(keepAliveInterval); // Stop pinging if not open
                        keepAliveInterval = null;
                    }
                }, 30000);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                     // console.log("Raw message:", data); // Log raw message for debugging

                    if (data.event === "pusher:pong") {
                        // console.log("Received pong");
                        return; // Ignore pong messages
                    }

                    if (data.event === "pusher_internal:subscription_succeeded") {
                        console.log(`Successfully subscribed to channel: ${data.channel}`);
                        displayMessage(null, `Subscribed to chat for ${channel}.`, true);
                        return;
                    }

                    if (data.event === "App\\Events\\ChatMessageEvent") {
                        try {
                            const messageData = JSON.parse(data.data);
                            // console.log("Parsed message data:", messageData); // Log parsed message
                            if (messageData.sender && messageData.content) {
                                displayMessage(messageData.sender.username, messageData.content);
                            } else {
                                console.warn("Received message without sender or content:", messageData);
                            }
                        } catch (e) {
                            console.error("Error parsing inner message data:", e, data.data);
                            displayMessage(null, "Error parsing chat message.", false, true);
                        }
                    } else {
                        // Log other event types for debugging if needed
                        // console.log("Received unhandled event type:", data.event, data.data ? JSON.parse(data.data) : '');
                    }
                } catch (e) {
                    console.error("Error processing WebSocket message:", e, event.data);
                     displayMessage(null, "Error processing WebSocket message.", false, true);
                }
            };

            ws.onerror = (error) => {
                // The event object itself might not be very informative in browsers for security reasons
                console.error("WebSocket Error:", error);
                 // Display a generic error; the console log during connection attempt or 'onclose' might be more specific.
                displayMessage(null, "WebSocket connection error occurred. Check console.", false, true);
                if (keepAliveInterval) clearInterval(keepAliveInterval);
                keepAliveInterval = null;
                 connectButton.disabled = false;
                 connectButton.textContent = 'Connect';
            };

            ws.onclose = (event) => {
                console.log(`WebSocket Disconnected. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
                let reasonMsg = `Disconnected from ${channel}.`;
                if (event.reason) {
                    reasonMsg += ` Reason: ${event.reason}`;
                }
                 if (event.code === 1006) {
                    reasonMsg += ` (Abnormal closure - check network or host: ${pusherHost})`;
                }
                displayMessage(null, reasonMsg, event.wasClean, !event.wasClean); // Show as error if not clean close
                if (keepAliveInterval) clearInterval(keepAliveInterval);
                keepAliveInterval = null;
                ws = null; // Ensure ws is null after closing
                connectButton.disabled = false;
                connectButton.textContent = 'Connect';
            };
        })
        .catch(error => {
            console.error("Error during channel fetch or initial connection setup:", error);
            displayMessage(null, `Error: ${error.message}`, false, true);
             connectButton.disabled = false;
             connectButton.textContent = 'Connect';
        });
}

connectButton.addEventListener('click', () => {
    const newChannelName = channelInput.value.trim().toLowerCase(); // Standardize to lowercase
    if (newChannelName) {
        channelName = newChannelName;
        channelInput.value = channelName; // Update input field if modified (e.g., trimmed)
        connectWebSocket(channelName);
    } else {
        displayMessage(null, "Please enter a valid channel name.", false, true);
    }
});

// Add Enter key listener to the input field
channelInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        connectButton.click(); // Simulate button click
    }
});


// Initial state message
displayMessage(null, "Enter a Kick channel name and click Connect.", true);