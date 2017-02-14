/**
 * Created by julia on 31.01.2017.
 */
let EventEmitter = require('eventemitter3');
let uws = require('ws');
let ws_port = process.env.ws_port;
let ws_host = process.env.ws_host;
let OPCODE = require('../structures/constants').MESSAGE_TYPES;
let _ = require('lodash');
let tracking_enabled = process.env.tracking_enabled;
let StatsD = require('hot-shots');
let dogstatsd = new StatsD();
let stat = process.env.tracking_name;
let removeShardTimeout;
let startShardTimeout;
class WsServer extends EventEmitter {
    constructor() {
        super();
        this.wss = new uws.Server({host: ws_host, port: ws_port, clientTracking: true, noServer: true}, () => {
            this.setupListeners()
        });
        this.shards = {};
    }

    setupListeners() {
        this.wss.on('connection', (ws) => {
            if (tracking_enabled) dogstatsd.increment(`${stat}.websocket_connect`);
            console.log('Connection!');
            this.onConnection(ws);
        });
        this.wss.on('error', (err) => this.onError(err));
    }

    onConnection(ws) {
        ws.on('message', (msg, flags) => this.onMessage(msg, flags, ws));
        ws.on('close', (code, number) => this.onDisconnect(code, number, ws));
        ws.on('error', (err) => this.onError(err));
        try {
            ws.send(JSON.stringify({op: OPCODE.identify}));
        } catch (e) {
            console.error(e);
        }
    }

    onError(err) {
        console.error(err);
    }

    onDisconnect(code, number, ws) {
        console.error(`Disconnect: Code: ${code} Number: ${number}`);
        if (tracking_enabled) dogstatsd.increment(`${stat}.websocket_disconnect`);
        _.forEach(this.shards, (shard) => {
            if (shard.ws === ws) {
                clearInterval(this.shards[shard.shardID].interval);
                console.log(`shard ${shard.shardID} is offline!`);
                this.shards[shard.shardID] = {
                    connected: false,
                    identified: false,
                    ready: false,
                    shardID: shard.shardID,
                    id: shard.shardID,
                    removeTimeOut: removeShardTimeout = setTimeout(() => {
                        this.removeShard(this.shards[shard.id]);
                    }, 60000)
                };
            }
        });
    }
    removeShard(shard) {
        let shardCount = Object.keys(this.shards).length;
        try {
            delete this.shards[shard.id];
            this.emit('shard_removed', {sid: Object.keys(this.shards).length - 1});
            console.log(`RESHARDING from ${shardCount} -> ${shardCount - 1}`);
            this.reassignShardIds();
            this.sendReady(true);
        } catch(e) {
            console.error(e);
        }
    }
    reassignShardIds() {
        let id = 0;
        let tempShards = {};
        for (let shard in this.shards) {
            if (this.shards.hasOwnProperty(shard)) {
                tempShards[id]=this.shards[shard];
                tempShards[id].id = id;
                tempShards[id].shardID = id;
                id++;
            }
        }
        this.shards = tempShards;
    }
    getShardId() {
        for (let shard in this.shards) {
            if (this.shards.hasOwnProperty(shard)) {
                if (!this.shards[shard].connected) {
                    console.log(`Using not connected shard ${this.shards[shard].id}!`);
                    if (this.shards[shard].removeTimeOut) {
                        clearTimeout(this.shards[shard].removeTimeOut);
                    }
                    return this.shards[shard].id;
                }
            }
        }
        console.log(`Using new shard ${Object.keys(this.shards).length}!`);
        return Object.keys(this.shards).length;
    }

    onMessage(msg, flags, ws) {
        try {
            msg = JSON.parse(msg);
        } catch (e) {
            console.error(msg);
            return console.error(e);
        }
        if (tracking_enabled) dogstatsd.increment(`${stat}.websocket`);
        // console.log(`Master: ${JSON.stringify(msg)}`);
        if (msg.shardToken !== process.env.shard_token) {
            try {
                ws.send({op: OPCODE.unauthorized});
            } catch (e) {
                console.error(e);
            }
            return ws.disconnect();
        }
        switch (msg.op) {
            case OPCODE.identify: {
                let reshard = false;
                clearTimeout(startShardTimeout);
                let shardId = this.getShardId();
                if (shardId === Object.keys(this.shards).length) {
                    reshard = true;
                    console.log(`RESHARDING from ${shardId} -> ${shardId+1}`);
                }
                console.log(shardId);
                this.shards[shardId] = {
                    id: shardId,
                    identified: true,
                    connected: true,
                    heartbeat: 15000,
                    shardID: shardId,
                    interval: null,
                    ws: ws
                };
                this.emit('shard_ready', {sid: shardId});
                startShardTimeout = setTimeout(() => {
                    this.sendReady(reshard);
                }, 20000);
                // ws.send(JSON.stringify({
                //     op: OPCODE.ready,
                //     d: {heartbeat: 15000, sid: shardId, shards: Object.keys(this.shards).length}
                // }));
                return;
            }
            case OPCODE.ready: {
                return;
            }
            case OPCODE.message: {
                // console.log(`Master: ${JSON.stringify(msg)}`);
                this.emit(msg.d.event, msg.d.data);
                return;
            }
            case OPCODE.hearbeat: {
                try {
                    ws.send(JSON.stringify({op: OPCODE.hearbeat}));
                } catch (e) {
                    console.error(e);
                }
                if (this.shards[msg.shardID]) {
                    // console.log(`Master: ${JSON.stringify(msg)}`);
                    clearInterval(this.shards[msg.shardID].interval);
                    this.shards[msg.shardID].interval = this.setupHearbeat(this.shards[msg.shardID].heartbeat, msg.shardID);
                }
                return;
            }
            default:
                return console.error(`Unkown Message ${JSON.stringify(msg)}`);
        }
    }

    sendReady(reshard) {
        _.forEach(this.shards, (shard) => {
            if (shard.connected && shard.identified) {
                if (reshard || !shard.ready) {
                    setTimeout(() => {
                        try {
                            shard.ws.send(JSON.stringify({
                                op: OPCODE.ready,
                                d: {
                                    heartbeat: 15000,
                                    sid: shard.id,
                                    shards: Object.keys(this.shards).length
                                }
                            }));
                        } catch (e) {
                            console.error(e);
                            shard.ws.close();
                        }
                        this.shards[shard.id].interval = this.setupHearbeat(shard.heartbeat, 0);
                        this.shards[shard.id].ready = true;
                    }, 6000);
                }
            }
        });
    }

    setupHearbeat(beat, id) {
        return setInterval(() => {
            this.emit('_heartbeat_fail', {shardID: id})
        }, beat);
    }

    broadcast(event, msg) {
        _.forEach(this.shards, (shard) => {
            if (shard.connected && shard.identified && shard.ready) {
                shard.ws.send(JSON.stringify({
                    op: OPCODE.message, d: {
                        event: event,
                        origin: `master`,
                        data: msg,
                        sendedAt: Date.now()
                    }
                }));
            }
        });
    }
}
module.exports = WsServer;