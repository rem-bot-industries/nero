/***
 * Created by Julian/Wolke on 01.11.2016.
 */
//uwu
let request = require('request');
let EventEmitter = require('eventemitter3');
let StatsD;
let dogstatsd;
let tracking_enabled = remConfig.tracking_enabled;
if (tracking_enabled) {
    StatsD = require('hot-shots');
    dogstatsd = new StatsD({host: remConfig.dogstatsd_host});
}
let stat = `rem_master_${remConfig.environment}`;
let discord_bots_token = remConfig.discord_bots_token;
let carbonitex_token = remConfig.carbonitex_token;
let bot_id = remConfig.bot_id;
let carbonitex_enabled = remConfig.carbonitex_enabled;
let discord_bots_enabled = remConfig.discord_bots_enabled;
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