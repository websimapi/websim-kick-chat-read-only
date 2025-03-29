// kick-ws.js - Handles Kick WebSocket connection logic

let ws = null;
let keepAliveInterval = null;
let currentChannel = null;
let displayCallback = () => {}; // Placeholder
let updateUICallback = () => {}; // Placeholder

/**
 * Displays a message using the provided callback.
 * @param {string|null} username
 * @param {string} content
 * @param {boolean} isStatus
 * @param {boolean} isError
 */
function displayMessage(username, content, isStatus = false, isError = false) {
    if (displayCallback) {
        displayCallback(username, content, isStatus, isError);
    } else {
        console.warn("displayCallback not set in kick-ws.js");
    }
}

/**
 * Updates the UI state using the provided callback.
 * @param {boolean} isConnecting
 * @param {boolean} isConnected
 * @param {string|null} errorReason
 */
function updateUI(isConnecting, isConnected, errorReason = null) {
     if (updateUICallback) {
         updateUICallback(isConnecting, isConnected, errorReason);
     } else {
         console.warn("updateUICallback not set in kick-ws.js");
     }
}

/**
 * Closes the current WebSocket connection if it exists.
 * @param {number} code WebSocket close code.
 * @param {string} reason WebSocket close reason.
 */
export function closeConnection(code = 1000, reason = "User requested disconnect") {
    if (ws) {
        console.log(`Closing WebSocket connection to ${currentChannel}. Code: ${code}, Reason: ${reason}`);
        ws.close(code, reason); // This will trigger the onclose handler for cleanup
    }
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
    ws = null; // Ensure it's nullified immediately
    currentChannel = null;
     // Update UI immediately for responsiveness, though onclose will also update
     updateUI(false, false);
}


/**
 * Establishes the WebSocket connection using provided details.
 * @param {string} channel The channel name.
 * @param {number} chatroomId The chatroom ID.
 * @param {object} pusherDetails The Pusher connection details (key, host, cluster).
 */
function establishWebSocketConnection(channel, chatroomId, pusherDetails) {
    const { key: pusherKey, host: pusherHost, cluster: pusherCluster } = pusherDetails;

    console.log(`Attempting WebSocket connection. Chatroom ID: ${chatroomId}`);
    console.log(`Using Pusher Key: ${pusherKey}, Host: ${pusherHost}, Cluster: ${pusherCluster || 'N/A'}`);

    const wsUrl = `wss://${pusherHost}/app/${pusherKey}?protocol=7&client=js&version=7.6.0&flash=false${pusherCluster ? `&cluster=${pusherCluster}` : ''}`;
    console.log("Connecting to WebSocket URL:", wsUrl);

    try {
        ws = new WebSocket(wsUrl);
    } catch (error) {
        console.error("WebSocket instantiation failed:", error);
        displayMessage(null, `Error creating WebSocket connection: ${error.message}`, false, true);
        updateUI(false, false, `WebSocket creation failed`);
        return; // Stop execution if WebSocket can't even be created
    }


    // --- WebSocket event handlers ---
    ws.onopen = () => {
        console.log("WebSocket connection opened.");
        displayMessage(null, `Connected to ${channel}. Subscribing to chat...`, true);
        // Don't update UI to "connected" yet, wait for subscription success

        ws.send(JSON.stringify({
            event: "pusher:subscribe",
            data: {
                auth: "",
                channel: `chatrooms.${chatroomId}.v2`
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

            if (msgData.event === "pusher:pong") {
                // console.log("Received pusher:pong"); // Optional: log pong
                return;
            }

            if (msgData.event === "pusher_internal:subscription_succeeded") {
                console.log(`Successfully subscribed to channel: ${msgData.channel}`);
                displayMessage(null, `Subscribed successfully. Listening for messages...`, true);
                updateUI(false, true); // Now we are truly connected and subscribed
                return;
            }

             if (msgData.event === "pusher:error") {
                console.error("Pusher Error:", msgData.data);
                let errorMsg = "Pusher error received.";
                if (msgData.data && msgData.data.message) {
                    errorMsg = `Pusher Error: ${msgData.data.message} (Code: ${msgData.data.code || 'N/A'})`;
                }
                displayMessage(null, errorMsg, false, true);
                if (ws && (msgData.data?.code === 4004 || msgData.data?.code === 4009 || msgData.data?.code === 4007)) {
                    closeConnection(msgData.data.code, msgData.data.message); // Use the closeConnection function
                } else {
                     updateUI(false, false, `Pusher Error: ${msgData.data?.code || 'Unknown'}`);
                }
                return;
             }

            if (msgData.event === "App\\Events\\ChatMessageEvent") {
                try {
                    const messagePayload = JSON.parse(msgData.data);
                    if (messagePayload.sender && messagePayload.content) {
                        if (typeof messagePayload.content === 'string') {
                            displayMessage(messagePayload.sender.username, messagePayload.content);
                        } else {
                            console.log("Received non-string message content:", messagePayload.content);
                            displayMessage(messagePayload.sender.username, '[System message or non-text content]');
                        }
                    } else {
                        console.warn("Received ChatMessageEvent without expected sender or content fields:", messagePayload);
                    }
                } catch (e) {
                    console.error("Error parsing inner JSON data string for ChatMessageEvent:", e, msgData.data);
                    displayMessage(null, "Error parsing chat message data.", false, true);
                }
            } else if (!msgData.event.startsWith("pusher:")) {
                 console.log("Received unhandled event type:", msgData.event, msgData.data ? JSON.parse(msgData.data) : '(no data)');
            }
        } catch (e) {
            console.error("Error processing WebSocket message:", e, event.data);
             displayMessage(null, "Error processing WebSocket message (see console).", false, true);
        }
    };

    ws.onerror = (error) => {
        console.error("WebSocket Error Event:", error);
        // Error details are usually vague here, onclose provides more context.
        // We *don't* call updateUI here, let onclose handle the final state.
    };

    ws.onclose = (event) => {
        console.log(`WebSocket Disconnected from ${channel}. Code: ${event.code}, Reason: "${event.reason || 'No reason provided'}", Was Clean: ${event.wasClean}`);
        let reasonMsg = `Disconnected from ${channel}.`;
        let isError = !event.wasClean && event.code !== 1000 && event.code !== 1001; // Treat non-clean/non-standard-close as error

        if (event.reason) {
            reasonMsg += ` Reason: ${event.reason}`;
        }

        // Provide more specific feedback based on common close codes
        switch(event.code) {
            case 1000: // Normal closure
                 reasonMsg = `Disconnected cleanly from ${channel}.`;
                 isError = false;
                break;
             case 1001: // Going Away
                 reasonMsg = `Channel closing or server shutting down for ${channel}.`;
                 isError = false;
                break;
            case 1006: // Abnormal Closure
                reasonMsg = `Connection to ${channel} lost unexpectedly. Check network or server status.`;
                isError = true;
                break;
            // Add more specific Pusher codes if needed, based on documentation/experience
            case 4004: reasonMsg = `Connection failed (${event.code}): App key/cluster issue for ${channel}.`; isError = true; break;
            case 4007: reasonMsg = `Connection failed (${event.code}): Connection limit likely reached for ${channel}.`; isError = true; break;
            case 4009: reasonMsg = `Connection failed (${event.code}): Auth issue or requires subscriber access for ${channel}?`; isError = true; break;
            case 4201: reasonMsg = `Connection failed (${event.code}): Rate limited connecting to ${channel}.`; isError = true; break;
            case 4301: reasonMsg = `Connection failed (${event.code}): Too many connections for ${channel}.`; isError = true; break;
            default:
                 if (!event.wasClean) {
                     reasonMsg += ` (Code: ${event.code})`;
                 }
                 break;
        }

        displayMessage(null, reasonMsg, !isError, isError);

        // Cleanup
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        keepAliveInterval = null;
        ws = null;
        currentChannel = null;
        updateUI(false, false, isError ? `Code ${event.code}: ${event.reason || 'Disconnect'}` : null);
    };
    // --- End of WebSocket event handlers ---
}

/**
 * Processes potential chatroom data sources to find connection details.
 * @param {object} data The data object from the fetch response.
 * @param {string} sourceUrl The URL the data was fetched from.
 * @returns {object|null} An object with {chatroomId, pusherDetails} or null if not found.
 */
function findConnectionDetails(data, sourceUrl) {
    console.log(`Processing data received from ${sourceUrl}.`);
    if (!data) {
        console.error(`No data received from ${sourceUrl}.`);
        return null;
    }

    let chatroomId = null;
    let pusherDetails = null;

    // --- Strategy 1: Look for data.chatroom.pusher_details (Common in v1 endpoint) ---
    if (data.chatroom && data.chatroom.id && data.chatroom.pusher_details && data.chatroom.pusher_details.host && data.chatroom.pusher_details.key) {
        console.log(`Found details nested under 'chatroom' property in data from ${sourceUrl}.`);
        chatroomId = data.chatroom.id;
        pusherDetails = data.chatroom.pusher_details; // Includes key, host, cluster
    }
    // --- Strategy 2: Look for details directly in data (Observed in old v2/chatroom, but seems broken now) ---
    else if (data.id && data.pusher_details && data.pusher_details.host && data.pusher_details.key) {
        console.log(`Found details directly in data from ${sourceUrl} (Less common/older structure).`);
        chatroomId = data.id;
        pusherDetails = data.pusher_details;
    }

    // --- Handle failure ---
    if (!chatroomId || !pusherDetails) {
        console.error(`Could not find required chatroom ID or Pusher details in the expected structure from ${sourceUrl}.`);
        // Log specific missing parts based on the checked structures
        if (data.chatroom) { // If chatroom object exists, check inside it
             const missing = [];
             if (!data.chatroom.id) missing.push("'chatroom.id'");
             if (!data.chatroom.pusher_details) missing.push("'chatroom.pusher_details' object");
             else {
                 if (!data.chatroom.pusher_details.host) missing.push("'chatroom.pusher_details.host'");
                 if (!data.chatroom.pusher_details.key) missing.push("'chatroom.pusher_details.key'");
             }
              if (missing.length > 0) console.error(` -> Within 'chatroom' object, missing: ${missing.join(', ')}.`);
        } else if (data.id && !data.pusher_details) { // If ID exists but no pusher_details at root
            console.error(" -> 'pusher_details' object is missing at the root level.");
        } else if (!data.id && !data.chatroom) { // If neither root ID nor chatroom object exists
            console.error(" -> Neither 'id' at root nor 'chatroom' object found.");
        } else {
            // General fallback log if specific checks above didn't pinpoint it
            console.error(" -> Required fields ('id'/'chatroom.id', 'pusher_details'/'chatroom.pusher_details') not found or incomplete.");
        }
        console.log("Raw data structure received:", JSON.stringify(data, null, 2)); // Log the structure for debugging
        return null;
    }

    console.log(`Successfully extracted Chatroom ID: ${chatroomId}, Pusher Host: ${pusherDetails.host}`);
    return { chatroomId, pusherDetails };
}


/**
 * Main function to connect to a Kick channel.
 * Fetches channel info and establishes WebSocket connection.
 * @param {string} channel The channel name to connect to.
 * @param {function} displayMsgCb Callback function for displaying messages.
 * @param {function} updateUICb Callback function for updating UI state.
 */
export async function connectToChannel(channel, displayMsgCb, updateUICb) {
    if (ws) {
        console.warn("Existing connection found. Please close it before starting a new one.");
        closeConnection(1000, "Starting new connection attempt");
        // Add a small delay to allow the close handler to potentially run
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    currentChannel = channel; // Store the channel name we are attempting to connect to
    displayCallback = displayMsgCb; // Store the callbacks
    updateUICallback = updateUICb;

    displayMessage(null, `Connecting to ${channel}...`, true);
    updateUI(true, false); // Set UI to connecting state

    const urlsToTry = [
        // Primary Strategy: v1 endpoint (seems most likely to contain chatroom details)
        `https://kick.com/api/v1/channels/${channel}`,
        // Fallback 1: v2 chatroom endpoint (known to lack pusher_details recently, but has ID)
        `https://kick.com/api/v2/channels/${channel}/chatroom`,
        // Fallback 2: v2 channel endpoint (also lacked pusher_details recently)
         // `https://kick.com/api/v2/channels/${channel}` // Often large, less likely useful now
    ];

    let connectionDetails = null;
    let errorMessages = [];

    for (const url of urlsToTry) {
        console.log(`Attempting to fetch channel data from: ${url}`);
        try {
            const response = await fetch(url);
            console.log(`Fetch response from ${url} - Status: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error ${response.status} from ${url}. Response: ${errorText.substring(0, 100)}...`);
            }

            const data = await response.json();
            connectionDetails = findConnectionDetails(data, url);

            if (connectionDetails) {
                console.log(`Successfully found connection details using ${url}`);
                break; // Exit loop if details are found
            } else {
                 // findConnectionDetails already logged the reason, just record for final error
                 errorMessages.push(`No valid details found in response from ${url}.`);
            }

        } catch (error) {
            console.error(`Error fetching or processing data from ${url}:`, error);
            errorMessages.push(`Failed attempt with ${url}: ${error.message}`);
        }

        // If details found, break was already called. If not, continue to next URL.
    }

    // After trying all URLs
    if (connectionDetails) {
        // Initiate WebSocket connection
        establishWebSocketConnection(channel, connectionDetails.chatroomId, connectionDetails.pusherDetails);
    } else {
        // All attempts failed
        console.error("Failed to retrieve connection details after trying all URLs.");
        let finalErrorMessage = `Error: Could not retrieve valid chatroom/Pusher details for '${channel}' after trying available endpoints.`;
        finalErrorMessage += "\nDetails:\n- " + errorMessages.join("\n- ");
        finalErrorMessage += "\nPlease verify the channel name exists. Kick's API might have changed, or the channel might be offline/inaccessible.";

        displayMessage(null, finalErrorMessage, false, true);
        updateUI(false, false, "Failed to get connection details");
        currentChannel = null; // Clear current channel as connection failed
    }
}