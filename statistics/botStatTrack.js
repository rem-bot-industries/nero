/***
 * Created by Julian/Wolke on 01.11.2016.
 */
//uwu
let request = require('request');
let EventEmitter = require('eventemitter3');
let StatsD = require('hot-shots');
process.env.dogstatd_host = process.env.dogstatd_host ? process.env.dogstatd_host : 'localhost';
let dogstatsd = new StatsD({host:process.env.dogstatd_host});
let stat = process.env.tracking_name;
let tracking_enabled = process.env.tracking_enabled;
let discord_bots_token = process.env.discord_bots_token;
let carbonitex_token = process.env.carbonitex_token;
let bot_id = process.env.bot_id;
let carbonitex_enabled = process.env.carbonitex_enabled;
let discord_bots_enabled = process.env.discord_bots_enabled;
/**
 * The stattrack engine
 * @extends EventEmitter
 *
 */
class BotStatTrack extends EventEmitter {
    /**
     * Create the stats engine.
     * @param {number} interval - the interval in seconds until the next update should be triggered
     */
    constructor(interval) {
        super();
        this.setMaxListeners(20);
        this.interval = setInterval(() => {
            this.emit('fetch');
        }, interval * 1000);
    }

    /**
     * Updates the stats on carbonitex and bots.discord.pw
     */
    update(guilds, users) {
        if (tracking_enabled) {
            dogstatsd.gauge(`${stat}.guilds`, guilds);
            dogstatsd.gauge(`${stat}.users`, users);
        }
        if (discord_bots_enabled) {
            let requestOptions = {
                headers: {
                    Authorization: discord_bots_token
                },
                url: `https://bots.discord.pw/api/bots/${bot_id}/stats`,
                method: 'POST',
                json: {
                    'server_count': guilds
                }
            };
            request(requestOptions, (err, response, body) => {
                if (err) {
                    return this.emit('error', err);
                }
                this.emit('info', 'Stats Updated!');
                this.emit('info', body);
            });
        }
        if (carbonitex_enabled) {
            let requestOptions = {
                url: 'https://www.carbonitex.net/discord/data/botdata.php',
                method: 'POST',
                json: {
                    'server_count': guilds,
                    'key': carbonitex_token
                }
            };
            request(requestOptions, (err, response, body) => {
                if (err) {
                    return this.emit('error', err);
                }
                this.emit('info', 'Stats Updated Carbon!');
                this.emit('info', body);
            });
        }

    }
}
module.exports = BotStatTrack;