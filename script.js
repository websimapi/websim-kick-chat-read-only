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

    if (isStatus) {
        messageElement.classList.add('status-message');
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
        ws.close();
    }
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
    }
    messagesContainer.innerHTML = ''; // Clear previous messages
    displayMessage(null, `Connecting to ${channel}...`, true);

    // Fetch channel ID
    fetch(`https://kick.com/api/v2/channels/${channel}`)
        .then(response => response.json())
        .then(data => {
            if (!data || !data.chatroom || !data.chatroom.id) {
                throw new Error(`Could not find channel: ${channel}`);
            }
            const chatroomId = data.chatroom.id;
            console.log(`Found chatroom ID: ${chatroomId}`);

            ws = new WebSocket(`wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false`);

            ws.onopen = () => {
                console.log("Connected to Kick chat WebSocket.");
                displayMessage(null, `Connected to ${channel}.`, true);
                ws.send(JSON.stringify({
                    event: "pusher:subscribe",
                    data: {
                        auth: "",
                        channel: `chatrooms.${chatroomId}.v2`
                    }
                }));

                 // Send ping every 30 seconds to keep connection alive
                keepAliveInterval = setInterval(() => {
                     if (ws.readyState === WebSocket.OPEN) {
                         ws.send(JSON.stringify({ event: "pusher:ping", data: {} }));
                        // console.log('Sent ping');
                     }
                 }, 30000);
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                // console.log("Raw message:", data); // Log raw message for debugging

                if (data.event === "pusher:pong") {
                    // console.log("Received pong");
                    return; // Ignore pong messages
                }

                if (data.event === "pusher_internal:subscription_succeeded") {
                     console.log(`Successfully subscribed to channel: ${data.channel}`);
                     return;
                }


                if (data.event === "App\\Events\\ChatMessageEvent") {
                     try {
                        const messageData = JSON.parse(data.data);
                        console.log("Parsed message data:", messageData); // Log parsed message
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
                    // console.log("Received unhandled event type:", data.event);
                 }

            };

            ws.onerror = (error) => {
                console.error("WebSocket Error:", error);
                displayMessage(null, "WebSocket Error. Check console.", false, true);
                if (keepAliveInterval) clearInterval(keepAliveInterval);
            };

            ws.onclose = (event) => {
                console.log("Disconnected from Kick chat.", event.code, event.reason);
                displayMessage(null, `Disconnected from ${channel}. ${event.reason || ''}`, true);
                if (keepAliveInterval) clearInterval(keepAliveInterval);
                 // Optionally try to reconnect or inform the user
            };

        })
        .catch(error => {
            console.error("Error fetching channel ID or connecting:", error);
            displayMessage(null, `Error: ${error.message}`, false, true);
        });
}


connectButton.addEventListener('click', () => {
    const newChannelName = channelInput.value.trim();
    if (newChannelName) {
        channelName = newChannelName;
        connectWebSocket(channelName);
    } else {
        displayMessage(null, "Please enter a valid channel name.", false, true);
    }
});

// Initial connection attempt if a default channel is set
// if (channelName) {
//     connectWebSocket(channelName);
// } else {
//      displayMessage(null, "Enter a channel name and click Connect.", true);
// }
displayMessage(null, "Enter a channel name and click Connect.", true);

