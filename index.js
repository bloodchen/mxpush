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

function setPingCheck(socket) {
    socket.isAlive = true
    const now = Math.floor(Date.now() / 1000)
    socket.pingCheck = now + 20
}
wss.on('connection', (socket, req) => {
    const ip = req.socket.remoteAddress;
    const uid = authenticateFromUrl(req.url)
    if (!uid) {
        socket.close(4001, "No Access")
        return
    }
    socket.uid = uid

    console.log(socket.uid, ' connected. count:', wss.clients.size)
    setPingCheck(socket)
    socket.on('pong', data => {
        setPingCheck(socket)
        //console.log('Received pong:', data.toString());
    });
    socket.on('message', message => {
        setPingCheck(socket)
        console.log(`Received message: ${message}`);
    });
    socket.on("close", (reason) => {
        console.log(socket.uid, ': disconnected', 'reason:', reason, ' count:', wss.clients.size)
    })
});
// 检测并关闭失去响应的连接
const interval = setInterval(() => {
    try {
        const now = Math.floor(Date.now() / 1000)
        console.log('clients:', wss.clients.size)
        for (const socket of wss.clients) {
            //console.log(socket.uid)
            if (!socket.isAlive) {
                console.log("unreponse socket detected. terminate.")
                socket.terminate();
                continue
            }
            if (socket.pingCheck > now) continue; //no need to check yet
            socket.isAlive = false;
            socket.ping();
        }
    } catch (e) {
        console.error(e.message)
    }
}, 10000);

wss.on('close', () => {
    console.log("sever closed")
    clearInterval(interval);
})

function findSocket(uid) {
    for (const ws of wss.clients) {
        if (ws.uid === uid) return ws
    }
    return null
}
function authenticateFromUrl(url) {
    const url = new URL(url, `http://${req.headers.host}`)
    const params = url.searchParams
    const auth = params.get('auth')
    const token = params.get('token')
    const uid = params.get('uid')
    if (!uid || !token) return null
    const { user_id } = userFromToken({ token })
    if (!user_id) return null
    return uid
}
// 处理升级请求，同时考虑CORS
app.server.on('upgrade', (req, socket, head) => {
    // 这里可以检查request.headers.origin，并决定是否接受连接
    //const origin = request.headers.origin;

    wss.handleUpgrade(req, socket, head, ws => {
        ws.uid = uid
        wss.emit('connection', ws, req);
        //clients[uid] = ws
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
    }
}
function userFromToken({ token }) {
    try {
        const data = decrypt({ data: token, password: tokenPass, from_encoding: "base64" })
        const user = JSON.parse(data)
        return user || {}
    } catch (e) {
        console.error(e.message)
    }
    return {}
}
dotenv.config()
startServer()
app.get('/', (req, res) => {
    console.log(req.url)
    return "ok"
})
app.get('/mxpush/url', async (req, res) => {
    return { url: 'this' }
})
app.get('/mxpush/status', async (req, res) => {
    return { count }
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
    for (const item of items) {
        const { uid, _r, data } = item
        if (!uid) return { code: 100, msg: 'uid is missing' }
        const uids = uid.split(',')
        for (const id of uids) {
            const socket = findSocket(id)
            if (socket) {
                if (_r) {
                    const reply = await getReply(socket, data)
                    ret[id] = ret.code === 100 ? ret : { code: 0, reply }
                } else {
                    delete item.uid
                    socket.send(JSON.stringify(item))
                    ret[id] = { code: 0, msg: "data sent" }
                    delivered++
                }
            } else {
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
            setPingCheck(socket)
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