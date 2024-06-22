import crypto from 'crypto';
import { nanoid } from 'nanoid'
import dotenv from "dotenv";

import { config } from './config.js'
import uWs from "uWebSockets.js"

const tokenPass = "2rnma5xsctJhx1Z$#%^09FYkRfuAsxTB"

function setAlive(socket) {
    // socket.isAlive = true
    // const now = Math.floor(Date.now() / 1000)
    // socket.pingCheck = now + 20
}
console.log('./uws_' + process.platform + '_' + process.arch + '_' + process.versions.modules + '.node')
const socketMap = new Map();
function findSocket(uid) {
    return socketMap.get(uid)
}

function authenticateFromUrl(u, def) {
    const url = new URL(u, def)
    const params = url.searchParams
    const auth = params.get('auth') || 'mx'
    const token = params.get('token')
    const uid = params.get('uid')
    const mxid = uid.split('_')[0]
    if (['208'].includes(mxid)) {
        console.log('authenticate:', u)
    }
    if (!uid || !token) return null

    const { user_id } = userFromToken({ token })
    if (!user_id) return null
    if (auth === 'mx') {
        const mxid = uid.split('_')[0]
        if (mxid != user_id) return null
    }
    //console.log("auth passed:", uid)
    return uid
}

async function startServer() {
    const app = uWs.App({})

    app.ws('/*', {
        compression: uWs.SHARED_COMPRESSOR,
        maxPayloadLength: 16 * 1024 * 1024,
        idleTimeout: 60,

        upgrade: (res, req, context) => {
            let method = req.getMethod();
            let host = req.getHeader('host');
            let url = req.getUrl();
            let query = req.getQuery();
            let fullUrl = `${method}://${host}${url}${query ? '?' + query : ''}`;
            const uid = authenticateFromUrl(fullUrl, `http://${host}`)
            const sid = nanoid()
            if (uid) {
                res.upgrade(
                    { uid, sid },
                    req.getHeader('sec-websocket-key'),
                    req.getHeader('sec-websocket-protocol'),
                    req.getHeader('sec-websocket-extensions'),
                    context
                );
            } else {
                console.error("rejected one client:", fullUrl)
                res.writeStatus('401 Unauthorized');
                res.end('Unauthorized');
            }
        },

        open: (ws) => {
            console.log(`Client connected: ${ws.uid} count:${socketMap.size + 1}`);
            const ip = ws.getRemoteAddressAsText()
            socketMap.set(ws.uid, ws)
        },

        message: (ws, message, isBinary) => {
            const msg = Buffer.from(message).toString();
            console.log(`Received message from ${ws.uid}: ${msg}`);
        },

        ping: (ws) => {
        },

        close: (ws, code, message) => {
            console.log(`Client disconnected: ${ws.uid} code:${code}  total count:${socketMap.size - 1}`);
            socketMap.delete(ws.uid)
        }
    })

    app.get('/mxpush/url', async (res, req) => {
        return { url: 'this' }
    })
    app.get('/', (res, req) => {
        let url = req.getUrl();
        const ip = getClientIp(req, res)
        console.log(ip)
        res.end(ip)
    })
    app.get('/count', (res, req) => {
        res.end(socketMap.size + '')
    })
    app.get('/test', async (res, req) => {
        const url = "https://push.mxfast.com/?uid=55505353_3bb7c8ca69a7ebc83db662dba0c97e4f75940000&token=NVQ6wXHqwMUdJM1mIbt4U1gdPyZKujk3t9%252FAxluCYpIs3qqbYrLIx4ECWp%252BhI%252FEl"
        return authenticateFromUrl(url)
    })
    app.get('/mxpush/info/', (res, req) => {
        const uid = req.query.uid
        const arr = []
        for (const uid in socketMap) {
            const ws = socketMap.get(uid)
            if (uid.split('_')[0] == uid)
                arr.push({ sid: ws.sid, uid: ws.uid })
        }
        return res.end(JSON.stringify({ count: arr.length, arr }))
    })

    app.post('/mxpush/isonline', (res, req) => {
        const { uids } = req.body
        const result = []
        const arr = uids.split(',')
        for (const uid of arr) {
            if (findSocket(uid)) {
                result.push(uid)
            }
        }
        return { code: 0, result }
    })
    async function getBody(res) {
        res.onAborted(err => {
            resolve(err)
        });
        return new Promise(resolve => {
            let buffer;
            /* Register data cb */
            res.onData((ab, isLast) => {
                let chunk = Buffer.from(ab);
                if (isLast) {
                    let json;
                    if (buffer) {
                        try {
                            json = JSON.parse(Buffer.concat([buffer, chunk]));
                        } catch (e) {
                            /* res.close calls onAborted */
                            res.close();
                            return;
                        }
                        resolve(json);
                    } else {
                        try {
                            json = JSON.parse(chunk);
                        } catch (e) {
                            /* res.close calls onAborted */
                            res.close();
                            return;
                        }
                        resolve(json);
                    }
                } else {
                    if (buffer) {
                        buffer = Buffer.concat([buffer, chunk]);
                    } else {
                        buffer = Buffer.concat([chunk]);
                    }
                }
            });

            /* Register error cb */
            res.onAborted(err);
        })
    }
    app.post('/mxpush/post', async (res, req) => {

        const { items, key } = await getBody(res)
        let delivered = 0, undelivered = "", ret = {}
        if (config.apiKeys.indexOf(key) === -1) return { code: 101, msg: 'invalid call' }
        console.log("got msg:", items)
        for (const item of items) {
            const { uid, _r, data } = item
            if (!uid) return { code: 100, msg: 'uid is missing' }
            const uids = uid.split(',')
            for (const id of uids) {
                const ws = findSocket(id)
                if (ws) {
                    console.log('found socket sid:', ws.sid, 'uid:', ws.uid)
                    if (_r) {
                        const reply = await getReply(ws, data)
                        console.log("msg sent and got reply. id:", id, 'msg:', item, "reply:", reply)

                        ret[id] = ret.code === 100 ? ret : { code: 0, reply }
                    } else {
                        delete item.uid
                        ws.send(JSON.stringify(item))
                        console.log(`msg sent. ${ws.sid}[${ws.uid}] msg:`, item)
                        ret[id] = { code: 0, msg: "data sent" }
                        delivered++
                    }
                } else {
                    console.error("socket not found for:", id)
                    ret[id] = { code: 101, msg: "socket broken" }
                }
            }
        }

        res.end(JSON.stringify({ code: 0, delivered, undelivered, ret }));

    })
    const port = process.env.port || 8080
    app.listen(port, (token) => {
        if (token)
            console.log("Starting mxpush service on:", port)
        else
            console.log('Failed to listen to port ' + port);
    });

}
function decrypt({ data, password, from_encoding = 'hex', to_encoding = 'utf8', length = 256 }) {
    try {
        const buf = Buffer.from(data, from_encoding)
        var iv = buf.subarray(0, 16)
        var algorithm = `aes-${length}-cbc`;
        var decipher = crypto.createDecipheriv(algorithm, Buffer.from(password), iv)
        var decrypted = Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]);
        return decrypted.toString(to_encoding);
    } catch (e) {
        return null
    } //NVQ6wXHqwMUdJM1mIbt4U1gdPyZKujk3t9%2FAxluCYpIs3qqbYrLIx4ECWp%2BhI%2FEl
    //NVQ6wXHqwMUdJM1mIbt4U1gdPyZKujk3t9%2FAxluCYpIs3qqbYrLIx4ECWp%2BhI%2FEl
    //Ce78jYANZG29RbuEH0GZu8PE+OTHTqUlHdu8hrfoMyTkd87tnfN77Y743oZBLQ4z

}
function userFromToken({ token }) {
    try {
        let data = null
        if (token.slice(0, 2) === '2-') { //v2 token
            data = decrypt({ data: token.slice(2), password: tokenPass, from_encoding: "hex" })
        } else
            data = decrypt({ data: token, password: tokenPass, from_encoding: "base64" })
        const user = JSON.parse(data)
        return user || {}
    } catch (e) {
        console.error(e.message)
    }
    return {}
    return {}
}
dotenv.config()
startServer()
function getClientIp(req, res) {
    const ip = req.getHeader('cf-connecting-ip') || req.getHeader('x-forwarded-for') || req.getHeader('x-real-ip') || res.getRemoteAddressAsText();
    return Buffer.from(ip).toString()
}

async function getReply(ws, data, timeout = 50000) {
    return new Promise(resolve => {
        const _id = nanoid()
        ws.send(JSON.stringify({ _r: true, _id, ...data }))
        const handler = (message) => {
            setAlive(ws)
            const data = JSON.parse(message)
            const { _rr } = data
            if (_rr && data._id === _id) {
                resolve(data)
                ws.off('message', handler)
            }
        }
        ws.on('message', handler)
        setTimeout(() => {
            ws.off('message', handler)
            resolve({ code: 100, msg: "timeout" })
        }, timeout)
    })
}