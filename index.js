import fastifyModule from 'fastify';
import dotenv from "dotenv";
import pkg from "better-sse";
import { config } from './config.js'

const { createSession } = pkg;

export const app = fastifyModule({ logger: false });

async function startServer() {
    const port = process.env.port || 8080
    await app.listen({ port, host: '0.0.0.0' });
    console.log("Starting login service on:", port)
}
dotenv.config()
startServer()
let count = 0
const clients = {}
app.get('/mxpush/get', async (req, res) => {
    const { uid } = req.query
    if (!uid) return { code: 100, msg: 'uid is missing' }
    if (clients[uid]) return { code: 101, msg: 'already connected' }
    console.log(uid, "connected. total = ", ++count)
    const eventName = process.env.eventName || 'mxpush'
    const session = await createSession(req.raw, res.raw, { headers: { "Access-Control-Allow-Origin": '*' } })
    clients[uid] = session
    session.on("disconnected", () => {
        console.log(uid, "disconnected. total = ", --count)
        delete clients[uid]
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