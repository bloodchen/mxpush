import fastifyModule from 'fastify';
import crypto from 'crypto';
import dotenv from "dotenv";
import pkg from "better-sse";

import { config } from './config.js'

const tokenPass = "2rnma5xsctJhx1Z$#%^09FYkRfuAsxTB"
const { createSession } = pkg;

export const app = fastifyModule({ logger: false });

async function startServer() {
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
let count = 0
const clients = {}
app.get('/mxpush/url', async (req, res) => {
    return { url: 'this' }
})
app.get('/mxpush/status', async (req, res) => {
    return { count }
})
app.get('/mxpush/connect', async (req, res) => {
    const { token, type = 'mx' } = req.query
    const { user_id } = userFromToken({ token })
    if (!user_id) return { code: 100, msg: 'invalid user' }
    if (clients[user_id]) return { code: 101, msg: 'already connected' }

    console.log(`[${user_id}]`, "connected. total = ", ++count)
    const eventName = process.env.eventName || 'mxpush'
    const session = await createSession(req.raw, res.raw, { headers: { "Access-Control-Allow-Origin": '*' } })
    clients[user_id] = session
    session.on("disconnected", () => {
        console.log(user_id, "disconnected. total = ", --count)
        delete clients[user_id]
    })
    session.push('connected', eventName)
})
app.post('/mxpush/post', async (req, res) => {
    const { items, key } = req.body
    const eventName = process.env.eventName || 'mxpush'
    let delivered = 0
    if (config.apiKeys.indexOf(key) === -1) return { code: 101, msg: 'invalid call' }
    for (const item of items) {
        const uid = item.uid
        if (!uid) return { code: 100, msg: 'uid is missing' }
        const uids = uid.split(',')
        uids.forEach(id => {
            const session = clients[id]
            if (session) {
                session.push(item.data, eventName)
                console.log('push to:', id, ' data:', item.data)
                delivered++
            }
        })
    }
    return { code: 0, delivered }
})