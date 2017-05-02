/**
 * Created by Julian on 16.04.2017.
 */
const WebsocketServer = require('./src/WebsocketServer');
const WsManager = require('./src/WsManager');
const winston = require('winston');
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
    'timestamp': true,
    'colorize': true
});
let config;
try {
    if (process.env.secret_name) {
        config = require(`/run/secrets/${process.env.secret_name}`);
        winston.info(`Using docker secrets!`);
    } else {
        config = require('./config/main.json');
        winston.info(`Using local secrets!`);
    }

} catch (e) {
    winston.error(e);
    winston.error('Failed to require config!');
    process.exit(1);
}
global.CONFIG = config;
global.OPCODE = require('./src/structures/OPCODES');
//Create a new Websocket Server and start it
const wsserver = new WebsocketServer(config.server);
wsserver.start();
//Create a new Websocket Manager
const wsManager = new WsManager(config);
wsserver.on('WS_CONNECT', (ws) => {
    wsManager.addWs(ws)
});
