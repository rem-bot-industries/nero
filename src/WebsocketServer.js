/**
 * Created by Julian on 13.04.2017.
 */
const EventEmitter = require('events').EventEmitter;
const wss = require('ws').Server;

/**
 * WebsocketServer for clients to connect to
 * @extends EventEmitter
 */
class WebsocketServer extends EventEmitter {
    constructor(options) {
        super();
        this.options = options;
    }

    /**
     * Creates a new Websocket server for clients to connect to
     * Options are passed directly to the wss
     */
    start() {
        this.ws = new wss(this.options);
        this.ws.on('connection', (ws) => {
            this.emit('WS_CONNECT', ws);
            // this.onConnection(ws);
        });

    }

    // onConnection(ws) {
    //     ws.on('message', (msg, flags) => this.onMessage(msg, flags, ws));
    //     ws.on('close', (code, number) => this.onDisconnect(code, number, ws));
    //     ws.on('error', (err) => this.onError(err, ws));
    // }
    //
    // onMessage(msg, flags, ws) {
    //     this.emit('WS_MESSAGE', {msg, flags, ws});
    // }
    //
    // onDisconnect(code, number, ws) {
    //     this.emit('WS_DISCONNECT', {code, number, ws});
    // }
    //
    // onError(err, ws) {
    //     this.emit('WS_ERROR', {err, ws});
    // }
    /**
     * Stops the server
     */
    stop() {
        if (this.ws) {
            this.ws.close();
        }
    }
}
module.exports = WebsocketServer;