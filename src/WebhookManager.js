/**
 * Created by Julian on 22.04.2017.
 */
const axios = require('axios');
const winston = require('winston');
class WebhookManager {
    constructor(options) {
        this.options = options;
    }

    async log(message, level = 'info') {
        try {
            let res;
            if (this.options.useEmbed) {
                res = await this.sendEmbed(message, level);
            } else {
                res = await this.sendText(message, level);
            }
        } catch (e) {
            if (e.response.statusCode === 429) {
                setTimeout(() => {
                    this.log(message);
                }, e.response.headers['retry-after'])
            } else {
                winston.error(e);
                throw new Error(e);
            }
        }
        return Promise.resolve();
    }

    async sendText(message, level) {
        return axios.post(this.options.url, {content: `[${level.toUpperCase()}][${new Date()}]:${message}`});
    }

    async sendEmbed(message, level) {
        return axios.post(this.options.url, {
            embeds: [{
                description: message,
                color: this.getColor(level),
                timestamp: new Date()
            }]
        });
    }

    getColor(level) {
        let color;
        switch (level) {
            case 'info':
                color = 0x3BC1ED;
                break;
            case 'warn':
                color = 0xF5A418;
                break;
            case 'error':
                color = 0xBA0B0B;
                break;
            default:
                color = 0xFFFFFF;
                break;
        }
        return color;
    }
}
module.exports = WebhookManager;