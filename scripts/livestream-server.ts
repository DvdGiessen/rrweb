/* tslint:disable: no-console */

import * as crypto from 'crypto';
import * as express from 'express';
import * as expressws from 'express-ws';
import * as ws from 'ws';
import * as fs from 'fs';
import * as path from 'path';

import { eventWithTime } from '../src/types';

// Port used for running from localhost
const port = 3000;
const app = expressws(express()).app;

// Store of all stream data
const streams: {
  [s: string]: {
    events: eventWithTime[];
    sockets: ws[];
  }
} = {};

// Dist files are available statically
app.use(express.static(path.resolve(__dirname, '../dist')));
app.use(express.static(path.resolve(__dirname, '../test/html')));

// Root page prints information to get started
app.get('/', (req, res) => {
  const streamId = crypto.randomBytes(16).toString('hex');
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>New livestream</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="X-UA-Compatible" content="ie=edge" />
        <link rel="stylesheet" href="rrweb.min.css" />
      </head>
      <body>
        <p>To start streaming, paste the following code in the console:</p>
        <code>(function(r,w,e,b){var s=w.getElementsByTagName(e)[0],n=w.createElement(e);n.async=true;n.src=b+'/broadcast.js';s.parentNode.insertBefore(n,s)})(window,document,'script','//${req.hostname}${req.hostname === 'localhost' ? `:${port}` : ''}/${streamId}');</code>
        <p>To watch the stream, go <a href="//${req.hostname}${req.hostname === 'localhost' ? `:${port}` : ''}/${streamId}">here</a>.</p>
      </body>
    </html>
  `);
});

// Custom broadcast.js file transmits to predefined websocket
app.get('/:streamId/broadcast.js', (req, res) => res.contentType('text/javascript').send(`
  (function() {
    var firstScript = document.getElementsByTagName('script')[0];
    var newScript = document.createElement('script');
    var scriptLoaded = false;
    newScript.async = true;
    newScript.onload = function() {
      scriptLoaded = true;
    };
    newScript.src = '//${req.hostname}${req.hostname === 'localhost' ? `:${port}` : ''}/rrweb.min.js';
    firstScript.parentNode.insertBefore(newScript, firstScript);
    var websocket = new WebSocket('ws${req.hostname === 'localhost' ? '' : 's'}://${req.hostname}${req.hostname === 'localhost' ? `:${port}` : ''}/${req.params.streamId}/websocket');
    websocket.addEventListener('open', function(socketevent) {
      var startRecord = function() {
        rrweb.record({
          emit: function(rrwebevent) {
            socketevent.target.send(JSON.stringify(rrwebevent));
          }
        });
      };
      if(scriptLoaded) {
        startRecord();
      } else {
        newScript.onload = startRecord;
      }
    });
  })();
`));

// WebSocket endpoint is bi-directional: No difference between broadcaster and watcher
app.ws('/:streamId/websocket', (ws, req) => {
  // Create new stream if not yet existed
  if(!streams[req.params.streamId]) {
    console.log(`Created new stream ${req.params.streamId}.`);
    streams[req.params.streamId] = {
      events: [],
      sockets: [],
    };
  }

  console.log(`New socket connected to stream ${req.params.streamId}.`);
  const {events, sockets} = streams[req.params.streamId];

  // Send all existing events
  for(const e of events) {
    ws.send(JSON.stringify(e));
  }

  // Receive and distribute new events
  sockets.push(ws);
  ws.on('message', (msg) => {
    const event: eventWithTime = JSON.parse(msg.toString());
    events.push(event);
    for(const s of sockets) {
      if(s !== ws) {
        s.send(JSON.stringify(event));
      }
    }
  });

  // On disconnect, remove socket from pool
  ws.on('close', () => {
    sockets.splice(sockets.indexOf(ws), 1);

    console.log(`Socket disconnected from stream ${req.params.streamId}.`);

    // Delete stream once last socket disconnects
    /*
    if(!sockets.length) {
      console.log(`Deleted stream ${req.params.streamId} since there were no connected sockets left.`);
      delete streams[req.params.streamId];
    }
    */
  });
});

// Stream viewer page. Retrieves events via websocket
app.get('/:streamId', (req, res) => {
  if(streams[req.params.streamId]) {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <title>Livestream ${req.params.streamId}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="X-UA-Compatible" content="ie=edge" />
          <link rel="stylesheet" href="rrweb.min.css" />
          <style>
            body, html {
              margin: 0;
              padding: 0;
            }
            body {
              background-color: black;
              text-align: center;
            }
            .replayer-wrapper {
              display: inline-block;
            }
            .replayer-wrapper iframe {
              border: 0;
            }
          </style>
        </head>
        <body>
          <script src="rrweb.min.js"></script>
          <script>
            const ws = new WebSocket('ws${req.hostname === 'localhost' ? '' : 's'}://${req.hostname}${req.hostname === 'localhost' ? `:${port}` : ''}/${req.params.streamId}/websocket');
            const events = [];
            const eventsQueue = [];
            let replayer = null;
            ws.addEventListener('message', (message) => {
              eventsQueue.push(JSON.parse(message.data));
              if(!replayer && eventsQueue.length >= 2) {
                while(eventsQueue.length) {
                  events.push(eventsQueue.shift());
                }
                replayer = new rrweb.Replayer(events);
                replayer.on('finish', () => {
                  while(eventsQueue.length) {
                    events.push(eventsQueue.shift());
                  }
                  replayer.resume();
                });
                replayer.play();
              }
            });
          </script>
        </body>
      </html>
    `);
  } else {
    res.send('Session not found');
  }
});

// Run livestream server app
const server = app.listen(port, () => console.log(`Now running on http://localhost:${port}`));
