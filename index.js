import fastifyModule from 'fastify';
import cors from '@fastify/cors'
import crypto from 'crypto';
import { nanoid } from 'nanoid'
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from 'ws';

import { config } from './config.js'


const tokenPass = "2rnma5xsctJhx1Z$#%^09FYkRfuAsxTB"
let count = 0

const app = fastifyModule({ logger: false });
const wss = new WebSocketServer({ noServer: true });

function setAlive(socket) {
    socket.isAlive = true
    const now = Math.floor(Date.now() / 1000)
    socket.pingCheck = now + 20
}

function closeAllSockets(uid) {
    for (const socket of wss.clients) {
        if (socket.uid === uid) {
            socket.isAlive = false
            console.log("close socket sid:", socket.sid, uid)
            socket.close(4001, "terminate")
        }
    }
}
const socketMap = new Map();

wss.on('connection', (socket, req) => {
    const ip = req.socket.remoteAddress;
    const uid = authenticateFromUrl(req.url, `http://${req.headers.host}`)
    if (!uid) {
        socket.close(4001, "No Access")
        return
    }
    //closeAllSockets(uid)
    socket.uid = uid
    socket.sid = nanoid()
    socketMap.set(uid, socket)

    console.log(`${socket.sid}[${socket.uid}] connected. count:${wss.clients.size}`)
    setAlive(socket)
    //socket.send(JSON.stringify({ cmd: 'connected', sid: socket.sid }))
    socket.on('pong', data => {
        setAlive(socket)
        //console.log('Received pong:', data.toString());
    });
    socket.on('message', message => {
        setAlive(socket)
        console.log(`Received message: ${message}`);
    });
    socket.on("close", (reason) => {
        socket.isAlive = false
        console.log(socket.uid, ': disconnected', 'reason:', reason, ' count:', wss.clients.size)
        socketMap.delete(socket.uid)
    })
});
// 检测并关闭失去响应的连接
function heartBeat() {
    try {
        const now = Math.floor(Date.now() / 1000)
        console.log('clients:', socketMap.size);
        for (const socket of wss.clients) {
            const { uid, sid } = socket
            if (!uid) continue
            if (!socket.isAlive) {
                console.log("unreponse socket detected. terminate:", uid)
                if (sid === socketMap.get(uid)?.sid) {
                    console.log("delete from map")
                    socketMap.delete(uid)

                }
                socket.terminate();
                continue
            } else {
                if (sid !== socketMap.get(uid)?.sid) {
                    console.log("close by server")
                    socket.close(4001, 'close by server')
                    continue
                }
            }
            if (socket.pingCheck > now) continue; //no need to check yet
            socket.isAlive = false;
            socket.ping();
        }
    } catch (e) {
        console.error(e.message)
    }
    setTimeout(heartBeat, 30000)
}
const interval = setTimeout(heartBeat, 30000);

wss.on('close', () => {
    console.log("sever closed")
    clearInterval(interval);
})

function findSocket(uid) {
    for (const ws of wss.clients) {
        if (ws.uid === uid && ws.isAlive) return ws
    }
    return null
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
// 处理升级请求，同时考虑CORS
app.server.on('upgrade', (req, socket, head) => {
    // 这里可以检查request.headers.origin，并决定是否接受连接
    //const origin = request.headers.origin;
    setAlive(socket)
    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
    });
});

async function startServer() {
    await app.register(cors, { origin: true, credentials: true, allowedHeaders: ['content-type'] });
    app.addHook("preHandler", async (req, res) => {
        console.log(req.url)
        if (req.url.indexOf('/mxpush/connect') != -1) {
            res.code(404).send("404")
            return
        }
    })
    const port = process.env.port || 8080
    await app.listen({ port, host: '0.0.0.0' });
    console.log("Starting mxpush service on:", port)
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
function getClientIp(req) {
    let IP =
        //req.ip ||
        req.headers['CF-Connecting-IP'] ||
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        req.connection.remoteAddress ||
        req.connection.socket.remoteAddress;
    IP = IP.split(',')[0]
    return IP;
}
app.get('/', (req, res) => {
    const ip = getClientIp(req)
    console.log(ip)
    return { ip }
})
app.get('/count', (req) => {
    return wss.clients.length
})
app.get('/test', async (req, res) => {
    const url = "https://push.mxfast.com/?uid=55505353_3bb7c8ca69a7ebc83db662dba0c97e4f75940000&token=NVQ6wXHqwMUdJM1mIbt4U1gdPyZKujk3t9%252FAxluCYpIs3qqbYrLIx4ECWp%252BhI%252FEl"
    return authenticateFromUrl(url)
})
app.get('/mxpush/url', async (req, res) => {
    return { url: 'this' }
})
app.get('/mxpush/info/', async (req, res) => {
    const uid = req.query.uid
    const arr = []
    for (const ws of wss.clients) {
        if (ws.uid.split('_')[0] == uid)
            arr.push({ sid: ws.sid, uid: ws.uid, isAlive: ws.isAlive })
    }
    return { count: arr.length, arr }
})
app.get('/mxpush/terminate/', async (req, res) => {
    const sid = req.query.sid
    const arr = []
    for (const ws of wss.clients) {
        if (ws.sid == sid) {
            ws.close(4001, "terminate")
            return { code: 0, msg: "success" }
        }
    }
    return { code: 0, msg: "not found" }
})
app.post('/mxpush/isonline', async (req, res) => {
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
app.post('/mxpush/post', async (req, res) => {
    const { items, key } = req.body
    const eventName = process.env.eventName || 'mxpush'
    let delivered = 0, undelivered = "", ret = {}
    if (config.apiKeys.indexOf(key) === -1) return { code: 101, msg: 'invalid call' }
    console.log("got msg:", items)
    for (const item of items) {
        const { uid, _r, data } = item
        if (!uid) return { code: 100, msg: 'uid is missing' }
        const uids = uid.split(',')
        for (const id of uids) {
            const socket = findSocket(id)
            if (socket) {
                console.log('found socket sid:', socket.sid, 'uid:', socket.uid)
                if (_r) {
                    const reply = await getReply(socket, data)
                    console.log("msg sent and got reply. id:", id, 'msg:', item, "reply:", reply)

                    ret[id] = ret.code === 100 ? ret : { code: 0, reply }
                } else {
                    delete item.uid
                    socket.send(JSON.stringify(item))
                    console.log(`msg sent. ${socket.sid}[${socket.uid}] msg:`, item)
                    ret[id] = { code: 0, msg: "data sent" }
                    delivered++
                }
            } else {
                console.error("socket not found for:", id)
                ret[id] = { code: 101, msg: "socket broken" }
            }
        }
    }
    return { code: 0, delivered, undelivered, ret }
})
async function getReply(socket, data, timeout = 50000) {
    return new Promise(resolve => {
        const _id = nanoid()
        socket.send(JSON.stringify({ _r: true, _id, ...data }))
        const handler = (message) => {
            setAlive(socket)
            const data = JSON.parse(message)
            const { _rr } = data
            if (_rr && data._id === _id) {
                resolve(data)
                socket.off('message', handler)
            }
        }
        socket.on('message', handler)
        setTimeout(() => {
            socket.off('message', handler)
            resolve({ code: 100, msg: "timeout" })
        }, timeout)
    })
}