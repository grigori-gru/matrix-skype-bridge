const concatStream = require('concat-stream');
const needle = require('needle');
const mime = require('mime-types');
const urlParse = require('url').parse;
const fetch = require('node-fetch');
const querystring = require('querystring');
const {AllHtmlEntities: Entities} = require('html-entities');
const entities = new Entities();
const log = require('./modules/log')(module);
const {bridge, puppet, SKYPE_USERS_TO_IGNORE, URL_BASE, clientData} = require('./config.js');
const {isTaggedMatrixMessage, servicePrefix, getSkypeID} = clientData;

// check if tag is right before file extension
const FILENAME_TAG_PATTERN = /^.+_mx_\..+$/;

const isFilenameTagged = filepath => !!filepath.match(FILENAME_TAG_PATTERN);

const utils = {
    isTypeErrorMessage: err =>
        ['ressource.messageType', 'EventMessage.resourceType'].reduce((acc, val) =>
            acc || err.stack.includes(val), false),

    getTextContent: (name, text) => `${name}:\n${text}`,

    isSkypeId: id => id.includes(':'),

    getNameFromId: id => id.substr(id.indexOf(':') + 1),

    getAvatarUrl: id => `https://avatars.skype.com/v1/avatars/${entities.encode(utils.getNameFromId(id))}/public?returnDefaultImage=false&cacheHeaders=true`,

    a2b: str => {
        if (str) {
            return new Buffer(str).toString('base64');
        }
        log.error('unexpected data for decode');
    },
    b2a: str => {
        if (str) {
            log.debug(str);
            return new Buffer(str, 'base64').toString('ascii');
        }
        log.error('unexpected data for decode');
    },

    getMatrixRoomAlias: skypeConverstaion => utils.a2b(skypeConverstaion),

    setRoomAlias: (roomId, alias) => {
        const encodeAlias = encodeURIComponent(alias);
        const query = querystring.stringify({'access_token': puppet.token});
        const url = `${URL_BASE}/directory/room/${encodeAlias}?${query}`;
        const body = {'room_id': roomId};
        return fetch(url, {
            method: 'PUT',
            body: JSON.stringify(body),
            headers: {'Content-Type': 'application/json'},
        })
            .then(res => {
                log.debug('Request for setting alias name %s for room %s in matrix have status %s ', alias, roomId, res.status);
            });
    },

    getDisplayName: matrixId => {
        const encodeSender = encodeURIComponent(matrixId);
        const url = `${URL_BASE}/profile/${encodeSender}/displayname`;
        return fetch(url)
            .then(body =>
                (body.status === 200 ? body.json() : null))
            .then(res =>
                (res ? res.displayname : res));
    },

    getNameToSkype: sender =>
        utils.getDisplayName(sender)
            .then(displayname => {
                const result = displayname || sender;
                log.debug('Display name for user %s in skype is %s', sender, result);
                return result;
            }),

    getRoomName: roomId => {
        const query = querystring.stringify({'access_token': puppet.token});
        const url = `${URL_BASE}/rooms/${roomId}/state/m.room.name?${query}`;
        return fetch(url)
            .then(res => res.json())
            .then(({name}) => {
                const result = name || 'Bingo-boom conversation';
                log.debug('Display name for roomId %s in skype is %s', roomId, result);
                return result;
            });
    },

    getMatrixUsers: users =>
        users
            .filter(user => !SKYPE_USERS_TO_IGNORE.includes(user))
            .map(user =>
                `@${user.split(':').pop()}:${bridge.domain}`),

    getStream: (url, data) => needle.get(url, data),

    downloadGetBufferAndHeaders: (url, data) =>
        new Promise((resolve, reject) => {
            let headers = {
                'content-type': 'application/octet-stream',
            };
            const stream = utils.getStream(url, data);
            stream.on('header', (_s, _h) => {
                headers = _h;
            });
            stream.pipe(concatStream(buffer => {
                resolve({buffer, headers});
            })).on('error', reject);
        }),

    getBufferAndType: (url, data) =>
        utils.downloadGetBufferAndHeaders(url, data)
            .then(({buffer, headers}) => {
                let type;
                const contentType = headers['content-type'];
                if (contentType) {
                    type = contentType;
                } else {
                    type = mime.lookup(urlParse(url).pathname);
                }
                [type] = type.split(';');
                return {buffer, type};
            }),


    getIdFromMatrix: (user, prefix = '') => {
        const [result] = user.replace(`@${prefix}`, '').split(':');
        return result;
    },

    getId: user =>
        (user.includes(servicePrefix) ?
            utils.b2a(utils.getIdFromMatrix(user, servicePrefix)) :
            getSkypeID(utils.getIdFromMatrix(user))),

    getSkypeMatrixUsers: (skypeCollection = [], matrixRoomUsers) => {
        const usersIds = matrixRoomUsers.map(user => utils.getId(user));
        return skypeCollection
            .map(({personId}) => personId)
            .filter(id => usersIds.includes(id));
    },

    // tag the message to know it was sent by the bridge
    autoTagger: (senderId, func) => (text = '') =>
        (senderId ? text : func(text)),


    isMatrixMessage: ({senderId}, text) =>
        (!senderId) && isTaggedMatrixMessage(text),

    isMatrixImage: ({text, path}) =>
        (isTaggedMatrixMessage(text) || isFilenameTagged(path)),
};

module.exports = utils;
