/**
 * Created by Julian on 16.04.2017.
 */
const ShardManager = require('./ShardManager');
const uuid = require('uuid/v4');
let shardingManager = new ShardManager();
class WsManager {
    constructor(options) {
        this.options = options;
        console.log(options);
        this.connections = {};
        this.readyTimeout = null;
    }

    addWs(ws) {
        let id = uuid();
        this.connections[id] = {ws, authenticated: false, heartbeat: 20000, heartbeatTimeout: null, id};
        this.connections[id].ws.send(JSON.stringify({op: OPCODE.IDENTIFY}));
        this.connections[id].ws.on('message', (msg, flags) => {
            this.onMessage(msg, flags, this.connections[id])
        });
        this.connections[id].ws.on('close', (code, number) => {
            this.onDisconnect(code, number, this.connections[id])
        });
        this.connections[id].authTimeout = setTimeout(() => {
            this.onAuthTimeout(this.connections[id]);
        }, 10 * 1000);
    }

    onMessage(msg, flags, connection) {
        console.log(msg);
        try {
            msg = JSON.parse(msg);
        } catch (e) {
            console.error(msg);
            return console.error(e);
        }
        switch (msg.op) {
            case OPCODE.IDENTIFY: {
                if (msg.d.token !== this.options.token) {
                    return connection.ws.close(4000, 'Bad Token!');
                }
                clearTimeout(this.connections[connection.id].authTimeout);
                let shardID;
                if (!msg.d.shardID) {
                    shardID = shardingManager.getShardId();
                }
                this.connections[connection.id].shardID = shardID;
                shardingManager.addShard({
                    id: shardID,
                    shardState: 'unknown',
                    wsState: 'authenticated',
                    guilds: 0,
                    users: 0,
                    channels: 0,
                    voice: 0,
                    voice_active: 0,
                    host: msg.d.host,
                    pid: msg.d.pid
                });
                clearTimeout(this.readyTimeout);
                this.readyTimeout = setTimeout(() => {
                    this.sendReady();
                }, 10 * 1000);
                return;
            }
            case OPCODE.HEARTBEAT: {
                this.onHeartbeat(msg, connection);
                return;
            }
            case OPCODE.MESSAGE: {
                if (msg.d.action) {
                    return this.runAction(msg, connection);
                }
                return;
            }
            case OPCODE.STATS_UPDATE: {
                shardingManager.updateShardStats(connection.shardID, msg.d);
                return;
            }
            case OPCODE.STATE_UPDATE: {
                shardingManager.updateShardState(connection.shardID, msg.d.state);
                return;
            }
            default:
                return console.error(`Unknown Message ${JSON.stringify(msg)}`);
        }
    }

    sendReady() {
        for (let key in this.connections) {
            if (this.connections.hasOwnProperty(key)) {
                let connection = this.connections[key];
                try {
                    connection.ws.send(JSON.stringify({
                        op: OPCODE.READY,
                        d: {
                            heartbeat: 20000,
                            sid: connection.shardID,
                            sc: shardingManager.getShardCount()
                        }
                    }));
                } catch (e) {
                    console.error(e);
                    return this.sendReady();
                }
                // console.log(connection.heartbeat);
                this.connections[connection.id].heartbeatTimeout = this.setupTimeout(this.connections[connection.id])
            }
        }
    }

    onHeartbeat(msg, connection) {
        if (typeof (this.connections[connection.id]) !== 'undefined') {
            connection.ws.send(JSON.stringify({op: OPCODE.HEARTBEAT}));
            clearTimeout(this.connections[connection.id].heartbeatTimeout);
            this.connections[connection.id].heartbeatTimeout = this.setupTimeout(this.connections[connection.id])
        }
    }

    onDisconnect(code, number, connection) {
        console.error(code, number);
        try {
            shardingManager.updateWsState(connection.shardID, 'disconnected');
        } catch (e) {

        }
        delete this.connections[connection.id];
    }

    onAuthTimeout(connection) {
        return connection.ws.close(4000, 'Auth Timeout!');
    }

    heartbeatTimeout(id) {
        if (typeof (this.connections[id]) !== 'undefined') {
            this.connections[id].shardState = 'unknown';
            this.connections[id].ws.close(4000, 'Heartbeat timeout');
        }
    }

    setupTimeout(connection) {
        return setTimeout(() => {
            this.heartbeatTimeout(connection.id);
        }, connection.heartbeat);
    }

    runAction(msg, connection) {
        console.log(msg);
        switch (msg.d.action) {
            case 'bot_info': {
                let shards = shardingManager.getAllShards(connection.shardID);
                connection.ws.send(JSON.stringify({
                    op: OPCODE.MESSAGE,
                    d: {shards, action: 'bot_info_data', actionId: msg.d.actionId}
                }));
                return;
            }
            default: {
                return;
            }
        }
    }

    broadcast(msg) {
        for (let key in this.connections) {
            if (this.connections.hasOwnProperty(key)) {
                let connection = this.connections[key];
                try {
                    connection.ws.send(JSON.stringify({
                        op: OPCODE.MESSAGE,
                        d: msg
                    }));
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }
}
module.exports = WsManager;