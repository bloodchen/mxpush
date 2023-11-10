import fastifyModule from 'fastify';
import cors from '@fastify/cors'
import crypto from 'crypto';
import dotenv from "dotenv";
import { WebSocketServer } from 'ws';

import { config } from './config.js'

const tokenPass = "2rnma5xsctJhx1Z$#%^09FYkRfuAsxTB"
const clients = {}
let count = 0

const app = fastifyModule({ logger: false });
const wsServer = new WebSocketServer({ noServer: true });
/*
wsServer.on('connection', (socket, req) => {
    const ip = req.socket.remoteAddress;
    console.log(socket.uid, ' connected. count:', ++count)

    socket.on('message', message => {
        console.log(`Received message: ${message}`);
        socket.send(`Hello, you sent -> ${message}`);
    });
    socket.on("close", (reason) => {
        console.log(socket.uid, ': disconnected', 'reason:', reason, ' count:', --count)
    })
});
wsServer.on('close', () => {
    console.log("sever closed")
})

function authenticate({ req, token, auth = 'mx' }) {
    const { user_id } = userFromToken({ token })
    return !!user_id
}
// 处理升级请求，同时考虑CORS
app.server.on('upgrade', (req, socket, head) => {
    // 这里可以检查request.headers.origin，并决定是否接受连接
    //const origin = request.headers.origin;
    console.log(req.url)
    const url = new URL(req.url, `http://${req.headers.host}`)
    const params = url.searchParams
    const auth = params.get('auth')
    const token = params.get('token')
    const uid = params.get('uid')
    const isAuth = authenticate({ req, token, auth });
    if (!isAuth || !uid) {
        socket.write(JSON.stringify({ code: 100, msg: 'No Access' }));
        socket.destroy();
        return;
    }
    wsServer.handleUpgrade(req, socket, head, ws => {
        ws.uid = uid
        wsServer.emit('connection', ws, req);
        clients[uid] = ws
    });
});
*/
async function startServer() {
    await app.register(cors, { origin: true, credentials: true, allowedHeaders: ['content-type'] });
    app.addHook("preHandler", async (req, res) => {
        console.log(req.url)
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

app.post('/mxpush/post', async (req, res) => {
    const { items, key } = req.body
    const eventName = process.env.eventName || 'mxpush'
    let delivered = 0, undelivered = ""
    if (config.apiKeys.indexOf(key) === -1) return { code: 101, msg: 'invalid call' }
    for (const item of items) {
        const { uid, type, data } = item
        if (!uid) return { code: 100, msg: 'uid is missing' }
        const uids = uid.split(',')
        uids.forEach(id => {
            const socket = clients[id]
            if (socket) {
                socket.send(data)
                delivered++
            } else {
                undelivered += id + ','
            }
        })
    }
    return { code: 0, delivered, undelivered }
})