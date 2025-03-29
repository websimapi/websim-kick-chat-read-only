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
        console.log(`Processing data received from ${sourceUrl}. Raw data:`, JSON.stringify(data, null, 2)); // Log the raw data structure

        let chatroomId = null;
        let pusherKey = null;
        let pusherHost = null;
        let pusherCluster = null;
        let foundDetails = false;

        // --- Try extracting data ---
        // Common structure seems to have chatroom details directly or nested
        // Check if data itself contains the necessary details (like from /chatroom endpoint)
        if (data && data.id && data.pusher_details && data.pusher_details.host && data.pusher_details.key) {
            console.log(`Found details directly in data from ${sourceUrl}.`);
            chatroomId = data.id;
            pusherKey = data.pusher_details.key;
            pusherHost = data.pusher_details.host;
            pusherCluster = data.pusher_details.cluster || null; // Cluster might be optional
            foundDetails = true;
        }
        // Check if data has a 'chatroom' property containing the details (like potentially from /channel endpoint, though recent logs suggest this failed)
        // Note: The previous logs indicated `data.chatroom` existed but lacked `pusher_details`. This check remains just in case the API structure varies or reverts.
        else if (data && data.chatroom && data.chatroom.id && data.chatroom.pusher_details && data.chatroom.pusher_details.host && data.chatroom.pusher_details.key) {
            console.log(`Found details nested under 'chatroom' property in data from ${sourceUrl}.`);
            chatroomId = data.chatroom.id;
            pusherKey = data.chatroom.pusher_details.key;
            pusherHost = data.chatroom.pusher_details.host;
            pusherCluster = data.chatroom.pusher_details.cluster || null;
            foundDetails = true;
        }

        // --- Handle failure to find details ---
        if (!foundDetails) {
             console.error(`Could not find required chatroom/Pusher details in the expected structure from ${sourceUrl}.`);
             // Log detailed missing parts based on the checked structure
             if (!data) {
                 console.error(" -> 'data' is missing or null.");
             } else {
                 const targetData = data.chatroom || data; // Reference the object where details were expected
                 const missing = [];
                 if (!targetData.id) missing.push("'id'");
                 if (!targetData.pusher_details) missing.push("'pusher_details' object");
                 else { // Only check host/key if pusher_details object exists
                     if (!targetData.pusher_details.host) missing.push("'pusher_details.host'");
                     if (!targetData.pusher_details.key) missing.push("'pusher_details.key'");
                 }
                 if (missing.length > 0) {
                    console.error(` -> Missing required fields: ${missing.join(', ')}.`);
                 } else if (!data.chatroom && data.id && data.pusher_details) {
                    // Edge case: if details were expected directly but not found, and there's no chatroom property
                    console.error(" -> Details expected directly in 'data', but structure mismatch or fields missing.");
                 } else if (data.chatroom && (!data.chatroom.id || !data.chatroom.pusher_details)) {
                     // Edge case: if details were expected in 'data.chatroom' but not found
                    console.error(" -> Details expected in 'data.chatroom', but structure mismatch or fields missing.");
                 }
             }
             console.log("Data structure received (logged above)."); // Refer to the raw log at the function start
             return false; // Indicate failure
        }

        // --- Proceed with WebSocket connection if details found ---
        console.log(`Using Chatroom ID: ${chatroomId} from ${sourceUrl}`);
        console.log(`Using Pusher Key: ${pusherKey}, Host: ${pusherHost}, Cluster: ${pusherCluster || 'N/A'}`);

        const wsUrl = `wss://${pusherHost}/app/${pusherKey}?protocol=7&client=js&version=7.6.0&flash=false${pusherCluster ? `&cluster=${pusherCluster}` : ''}`;
        console.log("Attempting to connect to WebSocket:", wsUrl);

        ws = new WebSocket(wsUrl);

        // --- WebSocket event handlers (onopen, onmessage, onerror, onclose) ---
        ws.onopen = () => {
            console.log("WebSocket connection opened.");
            displayMessage(null, `Connected to ${channel}. Subscribing to chat...`, true);
            connectButton.disabled = false; // Re-enable button only after successful connection AND subscription attempt
            connectButton.textContent = 'Connect'; // Reset button text

            ws.send(JSON.stringify({
                event: "pusher:subscribe",
                data: {
                    auth: "",
                    channel: `chatrooms.${chatroomId}.v2` // Use the dynamically found chatroomId
                }
            }));

            // Start keep-alive ping
            if (keepAliveInterval) clearInterval(keepAliveInterval);
            keepAliveInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
                    // console.log("Sent pusher:ping"); // Optional: log ping
                } else {
                    clearInterval(keepAliveInterval);
                    keepAliveInterval = null;
                }
            }, 30000); // Send ping every 30 seconds
        };

        ws.onmessage = (event) => {
             try {
                const msgData = JSON.parse(event.data);
                 // console.log("Raw WS message:", msgData); // Uncomment for deep debugging

                // Handle Pong response to Ping
                if (msgData.event === "pusher:pong") {
                    // console.log("Received pusher:pong"); // Optional: log pong
                    return;
                }

                // Handle successful subscription
                if (msgData.event === "pusher_internal:subscription_succeeded") {
                    console.log(`Successfully subscribed to channel: ${msgData.channel}`);
                    displayMessage(null, `Subscribed successfully. Listening for messages...`, true);
                    return; // Don't process further
                }

                 // Handle potential subscription errors from Pusher
                 if (msgData.event === "pusher:error") {
                    console.error("Pusher Error:", msgData.data);
                    let errorMsg = "Pusher error received.";
                    if (msgData.data && msgData.data.message) {
                        errorMsg = `Pusher Error: ${msgData.data.message} (Code: ${msgData.data.code || 'N/A'})`;
                    }
                    displayMessage(null, errorMsg, false, true);
                    // Optionally close the connection or handle specific error codes
                    // For example, code 4009 often means connection limit or auth issue
                    if (ws && (msgData.data?.code === 4004 || msgData.data?.code === 4009 || msgData.data?.code === 4007)) {
                        ws.close(msgData.data.code, msgData.data.message);
                    }
                    return;
                 }

                // Process actual chat messages
                if (msgData.event === "App\\Events\\ChatMessageEvent") {
                    try {
                        const messagePayload = JSON.parse(msgData.data);
                        // console.log("Parsed chat message data:", messagePayload); // Uncomment for debugging message structure
                        if (messagePayload.sender && messagePayload.content) {
                            if (typeof messagePayload.content === 'string') {
                                displayMessage(messagePayload.sender.username, messagePayload.content);
                            } else {
                                console.log("Received non-string message content (e.g., poll, gift):", messagePayload.content);
                                // Display a placeholder for non-text messages
                                displayMessage(messagePayload.sender.username, '[System message or non-text content]');
                            }
                        } else {
                            console.warn("Received ChatMessageEvent without expected sender or content fields:", messagePayload);
                        }
                    } catch (e) {
                        console.error("Error parsing inner JSON data string for ChatMessageEvent:", e, msgData.data);
                        displayMessage(null, "Error parsing chat message data.", false, true);
                    }
                } else if (msgData.event.startsWith("pusher:")) {
                    // Log other pusher events if needed, but don't treat as errors
                     // console.log("Received other Pusher event:", msgData.event, msgData.data ? JSON.parse(msgData.data) : '(no data)');
                } else {
                    // Log potentially unhandled non-Pusher events
                     console.log("Received unhandled event type:", msgData.event, msgData.data ? JSON.parse(msgData.data) : '(no data)');
                }
            } catch (e) {
                console.error("Error processing WebSocket message:", e, event.data);
                 displayMessage(null, "Error processing WebSocket message (see console).", false, true);
            }
        };

        ws.onerror = (error) => {
            // This usually fires just before onclose when there's a connection issue
            console.error("WebSocket Error Event:", error);
            // Displaying error in onclose is often more informative about the closure reason
            // displayMessage(null, "WebSocket connection error occurred. See console.", false, true);
            // Cleanup and UI update happens in onclose
        };

        ws.onclose = (event) => {
            console.log(`WebSocket Disconnected. Code: ${event.code}, Reason: "${event.reason || 'No reason provided'}", Was Clean: ${event.wasClean}`);
            let reasonMsg = `Disconnected from ${channel}.`;
             let isError = !event.wasClean; // Consider unclean close an error state

            if (event.reason) {
                reasonMsg += ` Reason: ${event.reason}`;
            }

             // Provide more specific feedback based on common close codes
            switch(event.code) {
                case 1000: // Normal closure
                     reasonMsg = `Disconnected cleanly from ${channel}.`;
                     isError = false; // Explicitly not an error
                    break;
                 case 1001: // Going Away
                     reasonMsg = `Channel closing or server shutting down for ${channel}.`;
                     isError = false;
                    break;
                case 1006: // Abnormal Closure
                    reasonMsg = `Connection to ${channel} lost unexpectedly. Check network or server status.`;
                    // Keep isError = true (default for unclean)
                    break;
                 case 4000: // Generic Pusher error range start
                 case 4004: // App key issue / Cluster mismatch
                 case 4007: // Connection limit likely
                 case 4009: // Connection authorized failed (might happen if auth needed later)
                 case 4201: // Rate limited
                 case 4301: // Too many connections
                     reasonMsg = `Connection closed by server (${event.code}): ${event.reason || 'Pusher error'}. Check API key, cluster, or connection limits.`;
                     isError = true; // Treat Pusher errors as errors
                    break;
                default:
                     if (!event.wasClean) {
                         reasonMsg += ` (Code: ${event.code})`;
                     }
                     break; // Use default message for other codes
            }

            displayMessage(null, reasonMsg, !isError, isError); // Display as status or error

            // Cleanup
            if (keepAliveInterval) clearInterval(keepAliveInterval);
            keepAliveInterval = null;
            ws = null; // Ensure ws is null after closing
            connectButton.disabled = false;
            connectButton.textContent = 'Connect';
        };
        // --- End of WebSocket event handlers ---

        return true; // Indicate successful initiation of connection attempt
    };

    // --- Fetching Logic ---
    // Try the dedicated chatroom endpoint first
    const chatroomUrl = `https://kick.com/api/v2/channels/${channel}/chatroom`;
    fetch(chatroomUrl)
        .then(response => {
            console.log(`Fetch response from ${chatroomUrl} - Status: ${response.status}`);
            if (!response.ok) {
                // Log response text for non-JSON errors (like 404 Not Found)
                return response.text().then(text => {
                     console.error(`Error response text from ${chatroomUrl}: ${text}`);
                     throw new Error(`Failed to fetch chatroom data from ${chatroomUrl} (Status: ${response.status})`);
                });
            }
            // Only attempt to parse JSON if response is OK
            return response.json();
        })
        .then(chatroomData => {
             // Attempt to process the data from the chatroom endpoint
            if (processChatroomDataAndConnect(chatroomData, chatroomUrl)) {
                // If processing is successful (meaning details found and WS connection initiated)
                console.log(`Successfully initiated connection using ${chatroomUrl}`);
                return; // Exit the promise chain here, connection is handled by WS events
            } else {
                // If processing failed (details not found in the expected structure)
                throw new Error(`Could not process/find required details in data from ${chatroomUrl}.`);
            }
        })
        .catch(error1 => {
            // This catches errors from fetch OR from the processing step above
            console.warn(`Attempt 1 (${chatroomUrl}) failed: ${error1.message}. Trying fallback URL...`);

            // Fallback: Try the general channel endpoint (less likely to contain pusher details based on recent logs, but kept as a fallback)
            const channelUrl = `https://kick.com/api/v2/channels/${channel}`;
            return fetch(channelUrl)
                .then(response => {
                    console.log(`Fetch response from ${channelUrl} - Status: ${response.status}`);
                    if (!response.ok) {
                         return response.text().then(text => {
                             console.error(`Error response text from ${channelUrl}: ${text}`);
                             throw new Error(`Failed to fetch channel data from ${channelUrl} (Status: ${response.status})`);
                         });
                    }
                    return response.json();
                })
                .then(channelData => {
                    // Attempt to process data from the channel endpoint
                    // Pass the entire channelData, as the processing function now checks both root and nested 'chatroom' properties
                    if (processChatroomDataAndConnect(channelData, channelUrl)) {
                        console.log(`Successfully initiated connection using fallback ${channelUrl}`);
                        // Connection initiated, exit promise chain
                    } else {
                         throw new Error(`Could not process/find required details in data from ${channelUrl}.`);
                    }
                })
                .catch(error2 => {
                    // This catches errors from the SECOND fetch/processing attempt
                    console.error("Fallback attempt failed:", error2.message);

                    // Combine error messages for a clearer final status
                    let finalErrorMessage = `Error: Could not retrieve valid chatroom/Pusher details for '${channel}' after trying multiple endpoints.`;
                     finalErrorMessage += `\nAttempt 1 (${chatroomUrl}): ${error1.message}`;
                     finalErrorMessage += `\nAttempt 2 (${channelUrl}): ${error2.message}`;
                    finalErrorMessage += "\nPlease verify the channel name exists and check the browser console for detailed logs (network tab might also be helpful). Kick API structure might have changed.";

                    displayMessage(null, finalErrorMessage, false, true);

                    // Ensure UI is reset after all attempts fail
                    connectButton.disabled = false;
                    connectButton.textContent = 'Connect';
                    if (keepAliveInterval) clearInterval(keepAliveInterval);
                    keepAliveInterval = null;
                    if (ws && ws.readyState !== WebSocket.CLOSED) {
                         ws.close(); // Ensure any partially opened socket is closed
                    }
                    ws = null;
                });
        });
}

connectButton.addEventListener('click', () => {
    const newChannelName = channelInput.value.trim().toLowerCase(); // Standardize to lowercase
    if (newChannelName) {
        channelName = newChannelName;
        channelInput.value = channelName; // Update input field if modified (e.g., trimmed)
        // Close existing connection cleanly before starting a new one
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log("Closing previous WebSocket connection before connecting to new channel.");
             displayMessage(null, `Disconnecting from previous channel...`, true);
             ws.close(1000, "User initiated new connection"); // Normal closure
             // Wait a very short moment for close event to potentially fire and clean up before connecting again
             setTimeout(() => connectWebSocket(channelName), 100);
        } else {
            connectWebSocket(channelName); // No existing connection, connect directly
        }
    } else {
        displayMessage(null, "Please enter a valid channel name.", false, true);
    }
});

channelInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        connectButton.click(); // Simulate button click
    }
});

// Initial state message
displayMessage(null, "Enter a Kick channel name and click Connect.", true);