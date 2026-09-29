require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const twilio = require('twilio');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);

// Two separate WebSocket servers: one for Twilio audio, one for Mobile Command Center
const wssTwilio = new WebSocketServer({ noServer: true });
const wssMobile = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    if (request.url === '/audiostream') {
        wssTwilio.handleUpgrade(request, socket, head, (ws) => {
            wssTwilio.emit('connection', ws, request);
        });
    } else if (request.url === '/mobile') {
        wssMobile.handleUpgrade(request, socket, head, (ws) => {
            wssMobile.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || 'dummy');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy' });
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'dummy';

let activeMobileWs = null;
wssMobile.on('connection', (ws) => {
    console.log('Mobile app connected to Command Center WS');
    activeMobileWs = ws;
    
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.action === 'override') {
                console.log('Manual override triggered from Command Center!');
                // Logic to redirect Twilio call to a SIP URI would go here
            }
        } catch (e) {
            console.error('Error in Mobile WS:', e);
        }
    });

    ws.on('close', () => { 
        console.log('Mobile app disconnected');
        activeMobileWs = null; 
    });
});

function sendToMobile(data) {
    if (activeMobileWs && activeMobileWs.readyState === 1) {
        activeMobileWs.send(JSON.stringify(data));
    }
}

// TwiML webhook
app.post('/incoming-call', (req, res) => {
    console.log('Incoming call received');
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: `wss://${req.headers.host}/audiostream` });
    res.type('text/xml');
    res.send(response.toString());
});

// Twilio WebSocket Server
wssTwilio.on('connection', (ws) => {
    console.log('New Twilio WebSocket connection established');
    let streamSid = null;
    let isSpeaking = false; 
    let abortController = new AbortController();

    const dgConnection = deepgram.listen.live({
        model: 'nova-2',
        encoding: 'mulaw',
        sample_rate: 8000,
        channels: 1,
        punctuate: true,
        interim_results: true,
    });

    dgConnection.on(LiveTranscriptionEvents.Open, () => {
        console.log('Deepgram STT connection opened');
    });

    dgConnection.on(LiveTranscriptionEvents.Transcript, async (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        const isFinal = data.is_final;

        if (transcript.trim() !== '') {
            sendToMobile({ type: 'transcript', role: 'user', text: transcript, isFinal });
            
            // BARGE-IN LOGIC
            if (isSpeaking) {
                console.log('Barge-in detected! Halting TTS.');
                ws.send(JSON.stringify({
                    event: 'clear',
                    streamSid: streamSid
                }));
                abortController.abort(); // Cancel ongoing TTS request
                isSpeaking = false;
            }

            if (isFinal) {
                isSpeaking = true;
                abortController = new AbortController();
                
                try {
                    // 1. LLM Processing
                    const chatCompletion = await groq.chat.completions.create({
                        messages: [
                            { role: 'system', content: 'You are an auto-insurance claim agent. Keep responses under 2 sentences.' },
                            { role: 'user', content: transcript }
                        ],
                        model: 'llama3-8b-8192',
                    });
                    const responseText = chatCompletion.choices[0].message.content;
                    sendToMobile({ type: 'transcript', role: 'agent', text: responseText, isFinal: true });
                    
                    // 2. TTS Processing (ElevenLabs with 8kHz ulaw format)
                    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream?output_format=ulaw_8000`, {
                        method: 'POST',
                        headers: {
                            'xi-api-key': ELEVENLABS_API_KEY,
                            'Content-Type': 'application/json',
                            'Accept': 'audio/mulaw'
                        },
                        body: JSON.stringify({
                            text: responseText,
                            model_id: "eleven_monolingual_v1"
                        }),
                        signal: abortController.signal
                    });
                    
                    if (ttsResponse.ok) {
                        const buffer = await ttsResponse.arrayBuffer();
                        const base64Audio = Buffer.from(buffer).toString('base64');
                        // 3. Send back to Twilio
                        if (!abortController.signal.aborted) {
                            ws.send(JSON.stringify({
                                event: 'media',
                                streamSid: streamSid,
                                media: { payload: base64Audio }
                            }));
                        }
                    }
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        console.error('AI Processing Error:', e);
                    }
                } finally {
                    isSpeaking = false;
                }
            }
        }
    });

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            switch (msg.event) {
                case 'start':
                    streamSid = msg.start.streamSid;
                    console.log(`Starting media stream: ${streamSid}`);
                    break;
                case 'media':
                    const payload = msg.media.payload;
                    const audioBuffer = Buffer.from(payload, 'base64');
                    // Forward audio to Deepgram
                    try {
                        dgConnection.send(audioBuffer);
                    } catch (e) {
                        // Deepgram socket might not be open yet
                    }
                    break;
                case 'stop':
                    console.log(`Media stream ${streamSid} ended.`);
                    try { dgConnection.finish(); } catch(e) {}
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Twilio WebSocket disconnected.');
        try { dgConnection.finish(); } catch(e) {}
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Backend server listening on port ${PORT}`);
});
