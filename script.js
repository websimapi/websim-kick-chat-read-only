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

    // Function to process chatroom data and connect WebSocket
    const processChatroomDataAndConnect = (data, sourceUrl) => {
        console.log(`Received data from ${sourceUrl}:`, data); // Log the full response

        if (!data || !data.pusher_details || !data.pusher_details.host || !data.pusher_details.key || !data.id) {
            console.error(`Could not find required chatroom or Pusher details in response from ${sourceUrl}. Missing:`,
                !data ? 'data' : '',
                !data?.id ? 'chatroom id' : '',
                !data?.pusher_details ? 'pusher_details' : '',
                !data?.pusher_details?.host ? 'pusher_details.host' : '',
                !data?.pusher_details?.key ? 'pusher_details.key' : ''
            );
            // Don't throw immediately, allow fallback if this was the first attempt
            return false; // Indicate failure to process
        }

        const chatroomId = data.id;
        const pusherKey = data.pusher_details.key;
        const pusherHost = data.pusher_details.host;
        const pusherCluster = data.pusher_details.cluster; // Extract cluster

        console.log(`Found chatroom ID: ${chatroomId} from ${sourceUrl}`);
        console.log(`Using Pusher Key: ${pusherKey}, Host: ${pusherHost}, Cluster: ${pusherCluster}`);

        // Construct the WebSocket URL using fetched details
        const wsUrl = `wss://${pusherHost}/app/${pusherKey}?protocol=7&client=js&version=7.6.0&flash=false`;
        console.log("Attempting to connect to:", wsUrl);

        ws = new WebSocket(wsUrl);

        // --- WebSocket event handlers (onopen, onmessage, onerror, onclose) ---
        // These remain largely the same as before, just moved inside this scope
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
                }
            }));

            // Send ping every 30 seconds to keep connection alive
            if (keepAliveInterval) clearInterval(keepAliveInterval); // Clear any previous interval
            keepAliveInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
                } else {
                    clearInterval(keepAliveInterval);
                    keepAliveInterval = null;
                }
            }, 30000);
        };

        ws.onmessage = (event) => {
             try {
                const msgData = JSON.parse(event.data);
                 // console.log("Raw message:", msgData); // Log raw message for debugging

                if (msgData.event === "pusher:pong") {
                    return; // Ignore pong messages
                }

                if (msgData.event === "pusher_internal:subscription_succeeded") {
                    console.log(`Successfully subscribed to channel: ${msgData.channel}`);
                    displayMessage(null, `Subscribed to chat for ${channel}.`, true);
                    return;
                }

                // Check for the correct chat message event
                // It seems the event name might vary or there might be different structures
                if (msgData.event === "App\\Events\\ChatMessageEvent" || msgData.event.includes("ChatMessageEvent")) { // Be flexible with event name
                    try {
                        // The actual message payload is often nested within the 'data' field,
                        // which itself is a JSON string.
                        const messagePayload = JSON.parse(msgData.data);
                        // console.log("Parsed message data:", messagePayload); // Log parsed message
                        if (messagePayload.sender && messagePayload.content) {
                             // Check if content is an object/array (like for polls/gifts) and skip or format differently if needed
                            if (typeof messagePayload.content === 'string') {
                                displayMessage(messagePayload.sender.username, messagePayload.content);
                            } else {
                                console.log("Received non-string message content:", messagePayload.content);
                                // Optionally display a placeholder or skip
                                // displayMessage(messagePayload.sender.username, '[Unsupported message type]');
                            }
                        } else {
                            console.warn("Received chat message event without sender or content:", messagePayload);
                        }
                    } catch (e) {
                        console.error("Error parsing inner message data string:", e, msgData.data);
                        displayMessage(null, "Error parsing chat message data.", false, true);
                    }
                } else {
                    // Log other event types for debugging
                     // console.log("Received unhandled event type:", msgData.event, msgData.data ? JSON.parse(msgData.data) : '(no data)');
                }
            } catch (e) {
                console.error("Error processing WebSocket message:", e, event.data);
                 displayMessage(null, "Error processing WebSocket message.", false, true);
            }
        };

        ws.onerror = (error) => {
            console.error("WebSocket Error:", error);
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
            } else if (event.code === 4004 || event.code === 4009 || event.code === 4007) { // Pusher specific close codes
                 reasonMsg += ` (App key/cluster issue or connection limit)`;
            }
            displayMessage(null, reasonMsg, event.wasClean, !event.wasClean); // Show as error if not clean close
            if (keepAliveInterval) clearInterval(keepAliveInterval);
            keepAliveInterval = null;
            ws = null; // Ensure ws is null after closing
            connectButton.disabled = false;
            connectButton.textContent = 'Connect';
        };
        // --- End of WebSocket event handlers ---

        return true; // Indicate success
    };

    // Try fetching chatroom details directly first
    const chatroomUrl = `https://kick.com/api/v2/channels/${channel}/chatroom`;
    fetch(chatroomUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch chatroom data from ${chatroomUrl} (Status: ${response.status})`);
            }
            return response.json();
        })
        .then(chatroomData => {
            if (processChatroomDataAndConnect(chatroomData, chatroomUrl)) {
                // Success using the direct chatroom endpoint
                return; // Exit the promise chain here
            } else {
                // If processing failed, throw an error to trigger the fallback/catch block
                throw new Error(`Could not process chatroom data from ${chatroomUrl}.`);
            }
        })
        .catch(error1 => {
            console.warn(`Failed to fetch/process from ${chatroomUrl}:`, error1.message, "Trying fallback URL...");
            // Fallback to the original channel endpoint
            const channelUrl = `https://kick.com/api/v2/channels/${channel}`;
            return fetch(channelUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch channel data from ${channelUrl} (Status: ${response.status})`);
                    }
                    return response.json();
                })
                .then(channelData => {
                     console.log(`Received data from ${channelUrl}:`, channelData); // Log the full response for the fallback

                    // Need to navigate down to the chatroom object in this response structure
                    if (!channelData || !channelData.chatroom) {
                         throw new Error(`Could not find chatroom object in response from ${channelUrl}`);
                    }
                    // Pass the chatroom sub-object to the processing function
                    if (!processChatroomDataAndConnect(channelData.chatroom, channelUrl)) {
                         throw new Error(`Could not process chatroom data from ${channelUrl}.`);
                    }
                     // If successful here, the function handles the rest
                })
                .catch(error2 => {
                    // This catches errors from both the first and second fetch/processing attempts
                    console.error("Error during channel/chatroom fetch or connection setup:", error2);
                    let finalErrorMessage = `Error: Could not retrieve valid chatroom/Pusher details for '${channel}'.`;
                    // Append specific error messages if available
                    if (error1.message) finalErrorMessage += `\nAttempt 1: ${error1.message}`;
                    if (error2.message && error2.message !== error1.message) finalErrorMessage += `\nAttempt 2: ${error2.message}`;
                    finalErrorMessage += "\nPlease check the channel name and Kick API status.";

                    displayMessage(null, finalErrorMessage, false, true);
                    connectButton.disabled = false;
                    connectButton.textContent = 'Connect';
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    keepAliveInterval = null;
                    ws = null; // Ensure ws is null after failure
                });
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